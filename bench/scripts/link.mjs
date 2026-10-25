#!/usr/bin/env node
import { lookup } from "node:dns/promises";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { Agent as HttpAgent, request as httpRequest } from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { assetPaths } from "../lib/assets.js";

// 链路测量：给一个 URL，量「这台机器到这个站」本身有多快。
//
// 与 probe.mjs 的分工：probe 问「这个站是什么、能测什么」，link 只问三个数：
//   RTT      建连一次要多久（TCP 连接时间就是 RTT 的实测值，ICMP 常被安全组挡掉）
//   TTFB     一次请求到出第一个字节要多久（冷连接 ≈ 3×RTT，复用连接 ≈ 1×RTT）
//   吞吐     这条路上真正能跑多少字节（用站点自己的静态资源，不写数据）
//
// 黑箱：不读站点配置，不 import 那两个项目，不假设跑在谁的机器上。
// 默认不碰 /api/：很多站会对 /api/ 限流，打快了量到的是限流不是速度。

const UA = "knot-bench/0.2 (+black-box link)";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const RESULTS_ROOT = path.join(ROOT, "results");
const MAX_BODY = 400_000;
const MAX_REDIRECTS = 3;

// 取中位数、p95：样本少的时候用最近秩（nearest-rank），不插值。
export function percentile(values, p) {
  const clean = (values || []).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!clean.length) return null;
  const rank = Math.ceil((p / 100) * clean.length);
  return clean[Math.min(clean.length - 1, Math.max(0, rank - 1))];
}

export function statsOf(values) {
  const clean = (values || []).filter((v) => Number.isFinite(v));
  if (!clean.length) return { n: 0, p50: null, p95: null, min: null, max: null };
  return {
    n: clean.length,
    p50: percentile(clean, 50),
    p95: percentile(clean, 95),
    min: Math.min(...clean),
    max: Math.max(...clean),
  };
}

// 首页里优先拿 JS（通常是最大的那个构建产物），没有就 CSS，再没有就不测吞吐。
export function pickDownloadPath(html) {
  const assets = assetPaths(html);
  return assets.find((p) => p.endsWith(".js")) || assets.find((p) => p.endsWith(".css")) || "";
}

export function mbpsOf(bytes, elapsedMs) {
  if (!Number.isFinite(bytes) || !Number.isFinite(elapsedMs) || elapsedMs <= 0) return null;
  return (bytes * 8) / elapsedMs / 1000;
}

// 一次 GET。socket 上的事件给出分段：connect=TCP 建连（含 DNS），secureConnect=TLS 握手完成。
// agent:false 让每次调用都是一条新连接，冷请求的数字才可比。
export function requestOnce(url, { headers = {}, timeoutMs = 15000, agent = false, capture = 0 } = {}) {
  return new Promise((resolve) => {
    let u;
    try {
      u = new URL(url);
    } catch (error) {
      resolve({ ok: false, url: String(url), status: 0, bytes: 0, marks: {}, error: `bad_url: ${error.message}` });
      return;
    }
    const send = u.protocol === "https:" ? httpsRequest : httpRequest;
    const started = process.hrtime.bigint();
    const at = () => Number(process.hrtime.bigint() - started) / 1e6;
    const marks = { reused: false };
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    let req;
    try {
      req = send(
        u,
        {
          method: "GET",
          agent,
          timeout: timeoutMs,
          headers: { "user-agent": UA, "accept-encoding": "identity", ...headers },
        },
        (res) => {
          marks.ttfb = at();
          const chunks = [];
          let bytes = 0;
          let captured = 0;
          res.on("data", (chunk) => {
            bytes += chunk.length;
            if (capture && captured < capture) {
              chunks.push(chunk);
              captured += chunk.length;
            }
          });
          res.on("end", () => {
            marks.total = at();
            let body = "";
            if (capture) {
              const buf = Buffer.concat(chunks);
              body = buf.subarray(0, capture).toString("utf8");
            }
            finish({
              ok: true,
              url,
              status: res.statusCode,
              headers: res.headers,
              bytes,
              body,
              ttfbMs: marks.ttfb,
              totalMs: marks.total,
              marks,
            });
          });
          res.on("error", (error) =>
            finish({ ok: false, url, status: res.statusCode || 0, bytes, marks, error: String(error.message || error) })
          );
        }
      );
    } catch (error) {
      finish({ ok: false, url, status: 0, bytes: 0, marks, error: String(error.message || error) });
      return;
    }

    req.on("socket", (socket) => {
      if (!socket.connecting) {
        // 复用连接：没有建连与握手，TTFB 就是一次往返。
        marks.reused = true;
        return;
      }
      socket.once("connect", () => {
        marks.tcp = at();
      });
      socket.once("secureConnect", () => {
        marks.tls = marks.tcp == null ? null : at() - marks.tcp;
        marks.protocol = typeof socket.getProtocol === "function" ? socket.getProtocol() : null;
        marks.alpn = socket.alpnProtocol || null;
      });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (error) =>
      finish({
        ok: false,
        url,
        status: 0,
        bytes: 0,
        marks,
        error: String(error.message || error),
      })
    );
    req.end();
  });
}

// 跟一次重定向，拿到真正被量的地址与首页 HTML（默认 / 会 302 到语言前缀）。
export async function resolveTarget(url, { timeoutMs = 15000 } = {}) {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const res = await requestOnce(current, { timeoutMs, capture: MAX_BODY });
    if (!res.ok) return { ...res, url: current, hops: hop };
    const location = res.headers.location;
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, current).toString();
      continue;
    }
    return { ...res, url: current, hops: hop };
  }
  return { ok: false, status: 0, bytes: 0, body: "", url: current, error: "too_many_redirects", hops: MAX_REDIRECTS };
}

// 吞吐：在 keep-alive 连接上反复取同一个静态资源，直到跑满目标字节数。
// 多次请求之间仍有 RTT，所以这是「这条路的下界」，不是裸带宽；
// 单流受窗口限制明显，默认用几路并发，`--streams 1` 看单流。
export async function measureDownload(url, { streams = 8, bytesTarget = 4 * 1024 * 1024, timeoutMs = 15000, deadlineMs = 20000 } = {}) {
  const agent =
    new URL(url).protocol === "https:"
      ? new HttpsAgent({ keepAlive: true, maxSockets: streams })
      : new HttpAgent({ keepAlive: true, maxSockets: streams });
  const started = process.hrtime.bigint();
  const elapsed = () => Number(process.hrtime.bigint() - started) / 1e6;
  let bytes = 0;
  let requests = 0;
  let assetBytes = null;
  let error = "";
  let complete = true;

  const worker = async () => {
    let misses = 0;
    while (bytes < bytesTarget && elapsed() < deadlineMs) {
      const res = await requestOnce(url, { agent, timeoutMs });
      requests += 1;
      if (!res.ok || res.status >= 400) {
        misses += 1;
        error = error || res.error || `http_${res.status}`;
        if (misses >= 2) return;
        continue;
      }
      misses = 0;
      if (assetBytes == null) assetBytes = res.bytes;
      bytes += res.bytes;
      if (!res.bytes) return;
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.max(1, streams) }, worker));
  } finally {
    agent.destroy();
  }
  const elapsedMs = elapsed();
  if (bytes < bytesTarget) complete = false;
  return {
    ok: bytes > 0,
    url,
    streams,
    bytes,
    requests,
    assetBytes,
    elapsedMs,
    mbps: mbpsOf(bytes, elapsedMs),
    complete,
    error,
  };
}

// 一次 POST：边写边看背压，写到 content-length 为止。
//
// 上行没有「只读」的目标可借：想量客户端发出的速度，必须有一个肯把请求体读进去的端点。
// 所以这里记两件事——写了多少字节、是不是在写完之前就回了响应：
//   · 全部写完才回 → 这段路确实吃下了这么多字节，时间可以当上行速率。
//   · 写到一半就回（413/401/405 常见）→ 服务端没有收完，这是「这里不接受这么大的体」，
//     不是「上行只有这么点」，报告会把两者分开说。
export function uploadOnce(url, { size, method = "POST", headers = {}, timeoutMs = 15000, agent = false, chunkSize = 64 * 1024 } = {}) {
  return new Promise((resolve) => {
    let u;
    try {
      u = new URL(url);
    } catch (error) {
      resolve({ ok: false, status: 0, requested: size || 0, written: 0, finishedWriting: false, earlyResponse: false, error: `bad_url: ${error.message}` });
      return;
    }
    const send = u.protocol === "https:" ? httpsRequest : httpRequest;
    const started = process.hrtime.bigint();
    const at = () => Number(process.hrtime.bigint() - started) / 1e6;
    // socket.write 不保证拷贝，同一块 buffer 连着写可能串字节；几块轮着用。
    const buffers = Array.from({ length: 4 }, () => Buffer.alloc(Math.max(1, Math.min(chunkSize, size || chunkSize)), 0));
    let cursor = 0;
    let written = 0;
    let finishedWriting = false;
    let earlyResponse = false;
    let settled = false;

    let req;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (req) req.destroy();
      resolve({ requested: size || 0, written, finishedWriting, earlyResponse, ...value });
    };

    try {
      req = send(u, {
        method,
        agent,
        timeout: timeoutMs,
        headers: {
          "user-agent": UA,
          "content-type": "application/octet-stream",
          "content-length": String(size || 0),
          ...headers,
        },
      });
    } catch (error) {
      resolve({ ok: false, status: 0, requested: size || 0, written: 0, finishedWriting: false, earlyResponse: false, error: String(error.message || error) });
      return;
    }

    const pump = () => {
      if (settled || earlyResponse) return;
      while (written < size) {
        const n = Math.min(buffers[0].length, size - written);
        const buffer = buffers[cursor % buffers.length];
        cursor += 1;
        written += n;
        const more = req.write(n === buffer.length ? buffer : buffer.subarray(0, n));
        if (!more) {
          req.once("drain", pump);
          return;
        }
      }
      finishedWriting = true;
      req.end();
    };

    req.on("response", (res) => {
      if (!finishedWriting) earlyResponse = true;
      const writeMs = at();
      res.resume();
      res.on("end", () =>
        finish({
          ok: res.statusCode < 400 && finishedWriting,
          status: res.statusCode,
          headers: res.headers,
          writeMs,
          totalMs: at(),
        })
      );
      res.on("error", (error) =>
        finish({ ok: false, status: res.statusCode || 0, writeMs, totalMs: at(), error: String(error.message || error) })
      );
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (error) => finish({ ok: false, status: 0, totalMs: at(), error: String(error.message || error) }));

    pump();
  });
}

// 上行吞吐：在 keep-alive 连接上反复 POST，直到发满目标字节数。
//
// 与下行同样的口径：每次请求都含一个往返，所以结果是这条路上「一次上传能跑多少」，
// 不是链路带宽的上限。并发路数越多越接近上限，但每个请求体都会落在服务的入口缓冲里，
// 别默认开太大。
export async function measureUpload(
  url,
  { streams = 8, bytesTarget = 4 * 1024 * 1024, size = 4 * 1024 * 1024, method = "POST", headers = {}, timeoutMs = 15000, deadlineMs = 20000 } = {}
) {
  const agent =
    new URL(url).protocol === "https:"
      ? new HttpsAgent({ keepAlive: true, maxSockets: streams })
      : new HttpAgent({ keepAlive: true, maxSockets: streams });
  const started = process.hrtime.bigint();
  const elapsed = () => Number(process.hrtime.bigint() - started) / 1e6;
  const bodySize = Math.max(1, Math.min(size, bytesTarget));
  const runs = [];
  let error = "";
  // 预算先扣再发：并发下「发完再看总量」会让每个 worker 都多发一笔，
  // 最后报出去的字节数比目标多出一整个请求体。
  let budget = bytesTarget;

  const worker = async () => {
    while (budget > 0 && elapsed() < deadlineMs) {
      budget -= bodySize;
      const run = await uploadOnce(url, { size: bodySize, method, headers, timeoutMs, agent });
      runs.push(run);
      if (!run.ok) {
        error = error || run.error || `http_${run.status}`;
        // 没吃下请求体，说明这个端点不接受这种大小的体，再发只是刷状态码。
        if (!run.finishedWriting) return;
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.max(1, streams) }, worker));
  } finally {
    agent.destroy();
  }

  const elapsedMs = elapsed();
  const bytes = runs.reduce((sum, run) => sum + run.written, 0);
  const statuses = {};
  for (const run of runs) statuses[run.status || 0] = (statuses[run.status || 0] || 0) + 1;
  const refused = runs.filter((run) => !run.finishedWriting).length;
  const accepted = runs.filter((run) => run.finishedWriting && run.status < 400).length;
  const first = runs[0] || null;
  return {
    ok: bytes > 0,
    url,
    streams,
    bodySize,
    bytes,
    requests: runs.length,
    accepted,
    refused,
    // 速率的分子是「请求体写完的字节」，分母是写它们的时间。只有在端点确实收下过一次
    // 请求体时，这两者才证明字节跨过了链路：
    //   · 写到一半就被回绝 → 那些字节根本没上路；
    //   · 一次都没被接受（全 4xx）→ 小请求体通常只是躺在内核缓冲里就返回了，
    //     量到的是「能多快塞进本机 socket」，不是这条链路的上行。
    // 字节数与请求次数照常记，降级的只是「速率」这一列。
    rateUsable: refused === 0 && accepted > 0,
    // 请求体太小时，样本几乎全是一个来回的延迟，量到的是「每秒能发几个请求」，
    // 不是带宽上限。阈值取 256KB：低于它在 60ms RTT 的链路上跑不到窗口极限。
    rttBound: bodySize < 256 * 1024,
    statuses,
    elapsedMs,
    mbps: mbpsOf(bytes, elapsedMs),
    complete: bytes >= bytesTarget,
    location: first?.headers?.location ? String(first.headers.location) : "",
    error,
  };
}

function normalizeBase(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  let u;
  try {
    u = new URL(text);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  return u;
}

function hostOf(u) {
  return u.host;
}

function machine() {
  return `${os.platform()}/${os.arch()} ${os.release()}`;
}

function gitRev() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: HERE, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

// 跑一轮：解析目标 → 冷连接 → 热连接 → 吞吐。不写文件，返回结果对象。
export async function measureLink(rawBase, options = {}) {
  const base = normalizeBase(rawBase);
  if (!base) throw new Error(`不是一个可测的 http/https 地址：${rawBase}`);

  const {
    path: targetPath = "/",
    download: downloadPath = "",
    samples = 20,
    warm = 20,
    streams = 8,
    bytesTarget = 4 * 1024 * 1024,
    timeoutMs = 15000,
    deadlineMs = 20000,
    upload: uploadPath = "",
    uploadMethod = "POST",
    uploadSize = 4 * 1024 * 1024,
    uploadHeaders = {},
  } = options;

  const startedAt = new Date().toISOString();
  const warnings = [];
  const baseUrl = base.toString().endsWith("/") ? base.toString() : `${base.toString()}/`;
  const requestedUrl = new URL(targetPath, baseUrl).toString();

  if (requestedUrl.includes("/api/") && samples + warm > 5) {
    warnings.push("目标在 /api/ 下：多数站对这一层有限流，冷、热请求连发会量到 429/503；建议 --samples ≤ 5、--warm 0，并拉开间隔，或改测静态路径");
  }

  // DNS 单独量一次。本机解析器与系统缓存都会影响它，只作参考。
  let dnsMs = null;
  let dnsError = "";
  const dnsStarted = process.hrtime.bigint();
  try {
    await lookup(base.hostname);
    dnsMs = Number(process.hrtime.bigint() - dnsStarted) / 1e6;
  } catch (error) {
    dnsError = String(error.message || error);
    warnings.push(`DNS 解析失败：${dnsError}`);
  }

  const target = await resolveTarget(requestedUrl, { timeoutMs });
  if (!target.ok) {
    return {
      meta: {
        base: requestedUrl,
        host: hostOf(base),
        machine: machine(),
        startedAt,
        finishedAt: new Date().toISOString(),
        samples,
        warm,
        streams,
        bytesTarget,
        warnings,
        git: gitRev(),
      },
      target: { url: requestedUrl, status: 0, bytes: 0, contentType: "", hops: target.hops || 0, error: target.error || "" },
      transport: { protocol: null, alpn: null, dnsMs, dnsError },
      cold: { n: 0, ok: 0, statuses: {}, tcp: statsOf([]), tls: statsOf([]), ttfb: statsOf([]), total: statsOf([]), error: target.error || "" },
      warm: { n: 0, ok: 0, ttfb: statsOf([]) },
      download: { ok: false, skipped: true, reason: "目标不可达，未测吞吐" },
      upload: { ok: false, skipped: true, reason: "目标不可达，未测上行" },
    };
  }

  const finalUrl = target.url;
  const isHttps = new URL(finalUrl).protocol === "https:";

  // 冷连接：每条请求一条新连接，量的是「第一次点开」。
  const coldRuns = [];
  for (let i = 0; i < samples; i += 1) {
    coldRuns.push(await requestOnce(finalUrl, { timeoutMs, agent: false }));
  }
  const statuses = {};
  for (const run of coldRuns) {
    const code = run.status || 0;
    statuses[code] = (statuses[code] || 0) + 1;
  }
  const good = coldRuns.filter((run) => run.ok && run.status < 400);
  const throttled = (statuses[429] || 0) + (statuses[503] || 0);
  if (throttled) {
    warnings.push(`冷请求里有 ${throttled} 次 429/503：目标可能限流，这组数字反映的是限流不是链路；把 --samples 调小并拉开间隔`);
  }
  if (good.length < coldRuns.length) {
    const failed = coldRuns.filter((run) => !run.ok || run.status >= 400);
    const sampleError = failed.find((run) => run.error)?.error || `http_${failed[0]?.status || 0}`;
    warnings.push(`冷请求失败 ${failed.length}/${coldRuns.length}（${sampleError}）`);
  }

  // 热连接：一条连接上连发，量的是复用之后每次交互的往返。
  let warmRuns = [];
  if (warm > 0) {
    const agent = isHttps ? new HttpsAgent({ keepAlive: true, maxSockets: 1 }) : new HttpAgent({ keepAlive: true, maxSockets: 1 });
    try {
      await requestOnce(finalUrl, { timeoutMs, agent });
      for (let i = 0; i < warm; i += 1) {
        const run = await requestOnce(finalUrl, { timeoutMs, agent });
        if (run.ok && run.status < 400) warmRuns.push(run);
      }
    } finally {
      agent.destroy();
    }
    if (!warmRuns.length) warnings.push("热连接请求全部失败，未得到复用往返");
  }

  // 吞吐：默认取首页里最大的一个构建产物；首页没有 /assets 就跳过。
  let download = { ok: false, skipped: true, reason: "首页没有 /assets 资源；用 --download 指定一个静态文件" };
  const assetPath = downloadPath || pickDownloadPath(target.body);
  if (assetPath) {
    const assetUrl = new URL(assetPath, finalUrl).toString();
    download = await measureDownload(assetUrl, { streams, bytesTarget, timeoutMs, deadlineMs });
    if (!download.ok) warnings.push(`吞吐请求失败：${download.error || "空响应"}`);
    else if (!download.complete) {
      warnings.push(`吞吐在 ${Math.round(download.elapsedMs)}ms 内只跑到 ${(download.bytes / 1024 / 1024).toFixed(1)}MB，未达目标 ${(bytesTarget / 1024 / 1024).toFixed(1)}MB，速率偏低`);
    }
  } else {
    warnings.push(download.reason);
  }

  // 上行：只有给了端点才测。上行必须往某个肯读请求体的地址发数据，
  // 「随便找个地址 POST 一下」在限了 client_max_body_size 或直接 405 的地方
  // 只会量到服务端多快拒收，所以端点由调用方指定，脚本不自作主张。
  let upload = { ok: false, skipped: true, reason: "未给 --upload-path：上行需要一个接受请求体的端点，不猜" };
  if (uploadPath) {
    const uploadUrl = /^https?:\/\//i.test(uploadPath) ? uploadPath : new URL(uploadPath, finalUrl).toString();
    upload = await measureUpload(uploadUrl, {
      streams,
      bytesTarget,
      size: uploadSize,
      method: uploadMethod,
      headers: uploadHeaders,
      timeoutMs,
      deadlineMs,
    });

    if (!upload.ok) {
      warnings.push(`上行请求全部失败：${upload.error || "空响应"}`);
    } else if (upload.refused) {
      // 写到一半就被回绝：服务端没收完，这段路的速率还没量到。
      const biggest = upload.bodySize;
      warnings.push(
        `上行 ${upload.refused}/${upload.requests} 次在写完前被回绝（状态 ${Object.keys(upload.statuses).join("/")}）：${new URL(uploadUrl).pathname} 不接受 ${fmtBytes(
          biggest
        )} 的请求体。${upload.location ? `端点重定向到 ${upload.location}，用最终地址重试。` : "多半是 client_max_body_size 或这条路径不接 POST；换一个收得下这么大体的端点，或把 --upload-size 调到该部署的上限以内。"}`
      );
    } else if (!upload.rateUsable) {
      // 每次都在写完以后被拒：请求体很小的时候，它只是进了本机内核缓冲就返回了，
      // 服务端可能一个字节都没读。这时写时间是「塞进 socket 有多快」，不是上行。
      warnings.push(
        `上行 ${upload.requests} 次全部被拒绝（状态 ${Object.keys(upload.statuses).join("/")}），没有一次被端点收下：写入时间反映本机缓冲，不构成这条链路的速率。${upload.location ? `端点重定向到 ${upload.location}。` : "换一个真会收下请求体的端点（带上鉴权），或先把 --upload-size 调到该端点的上限以内。"}`
      );
    } else if (!upload.complete) {
      warnings.push(`上行在 ${Math.round(upload.elapsedMs)}ms 内只发出 ${fmtBytes(upload.bytes)}，未达目标 ${fmtBytes(bytesTarget)}，速率偏低`);
    }
    if (upload.statuses?.[413]) warnings.push("上行收到 413 Request Entity Too Large：这个地址的请求体上限比 --upload-size 小");
    if (upload.statuses?.[401] || upload.statuses?.[403]) {
      warnings.push("上行收到 401/403：端点要鉴权（--upload-token-file / --upload-cookie-file 或对应的环境变量）");
    }
    if (upload.statuses?.[301] || upload.statuses?.[302]) {
      warnings.push("上行收到 3xx：端点地址要换成重定向后的那个，否则量到的是重定向本身");
    }
    if (upload.ok && upload.rateUsable && upload.rttBound) {
      warnings.push(
        `上行每次只发 ${fmtBytes(upload.bodySize)}：这个数主要反映「每秒能发几个请求」，不是上行带宽。要看带宽，把 --upload-size 调到端点上限附近（如 4m）`
      );
    }
  }
  if (uploadPath && requestedUrl.includes("/api/")) {
    // 上行端点常常就在 /api/ 下：这一层的限流在并发会先撞上。
    warnings.push("上行端点在 /api/ 下：并发升高时可能先撞限流，看到成片 429/503 就把 --streams 调小");
  }

  return {
    meta: {
      base: requestedUrl,
      host: hostOf(base),
      finalUrl,
      machine: machine(),
      startedAt,
      finishedAt: new Date().toISOString(),
      samples,
      warm,
      streams,
      bytesTarget,
      warnings,
      git: gitRev(),
    },
    target: {
      url: finalUrl,
      status: target.status,
      bytes: target.bytes,
      contentType: String(target.headers["content-type"] || ""),
      hops: target.hops || 0,
    },
    transport: {
      protocol: target.marks?.protocol || (isHttps ? null : "http"),
      alpn: target.marks?.alpn || null,
      dnsMs,
      dnsError,
    },
    cold: {
      n: coldRuns.length,
      ok: good.length,
      statuses,
      tcp: statsOf(good.map((run) => run.marks?.tcp)),
      tls: statsOf(good.map((run) => run.marks?.tls)),
      ttfb: statsOf(good.map((run) => run.ttfbMs)),
      total: statsOf(good.map((run) => run.totalMs)),
    },
    warm: {
      n: warmRuns.length,
      ok: warmRuns.length,
      ttfb: statsOf(warmRuns.map((run) => run.ttfbMs)),
    },
    download,
    upload,
  };
}

function fmt(value, digits = 0) {
  return value == null || !Number.isFinite(value) ? "-" : value.toFixed(digits);
}

function fmtBytes(bytes) {
  if (!Number.isFinite(bytes)) return "-";
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${bytes}B`;
}

export function summaryLines(result) {
  const cold = result.cold;
  const warm = result.warm;
  const lines = [];
  lines.push(`测点   ${result.meta.base} → ${new URL(result.meta.finalUrl).pathname} (${result.target.status} · ${fmtBytes(result.target.bytes)})`);
  lines.push(
    `链路   ${result.transport.protocol || "http"} · ALPN ${result.transport.alpn || "-"} · DNS ${fmt(result.transport.dnsMs, 1)}ms`
  );
  lines.push(`TCP    p50 ${fmt(cold.tcp.p50)}ms · p95 ${fmt(cold.tcp.p95)}ms（含 DNS；建连约等于 RTT）`);
  if (cold.tls.n) lines.push(`TLS    p50 ${fmt(cold.tls.p50)}ms · p95 ${fmt(cold.tls.p95)}ms`);
  lines.push(
    `冷请求 ${cold.ok}/${cold.n} 成功 · TTFB p50 ${fmt(cold.ttfb.p50)}ms · p95 ${fmt(cold.ttfb.p95)}ms · total p50 ${fmt(cold.total.p50)}ms`
  );
  if (warm.n) lines.push(`热请求 ${warm.n} 次 · TTFB p50 ${fmt(warm.ttfb.p50)}ms · p95 ${fmt(warm.ttfb.p95)}ms（同一连接）`);
  if (result.download?.ok) {
    lines.push(
      `下行   ${new URL(result.download.url).pathname} · ${fmtBytes(result.download.bytes)} / ${result.download.requests} 次 / ${fmt(
        result.download.elapsedMs / 1000,
        2
      )}s · ${fmt(result.download.mbps, 1)}Mbps（${result.download.streams} 流）`
    );
  } else if (result.download?.skipped) {
    lines.push(`下行   未测：${result.download.reason}`);
  }
  if (result.upload?.ok && result.upload.rateUsable) {
    lines.push(
      `上行   ${new URL(result.upload.url).pathname} · ${fmtBytes(result.upload.bytes)} / ${result.upload.requests} 次 / ${fmt(
        result.upload.elapsedMs / 1000,
        2
      )}s · ${fmt(result.upload.mbps, 1)}Mbps（${result.upload.streams} 流）`
    );
  } else if (result.upload?.ok) {
    const status = Object.keys(result.upload.statuses || {}).join("/");
    lines.push(
      result.upload.refused
        ? `上行   端点拒收：${new URL(result.upload.url).pathname} · 写入 ${fmtBytes(result.upload.bytes)} 后被回绝（状态 ${status}），不构成速率`
        : `上行   无速率：${new URL(result.upload.url).pathname} · 写入 ${fmtBytes(result.upload.bytes)} 但 ${result.upload.requests} 次全被拒绝（状态 ${status}），没有一次收下请求体`
    );
  } else if (result.upload?.skipped) {
    lines.push(`上行   未测：${result.upload.reason}`);
  }
  if (result.download?.mbps && result.upload?.rateUsable && !result.upload.rttBound) {
    lines.push(`上下比 下行 / 上行 = ${(result.download.mbps / result.upload.mbps).toFixed(1)}×`);
  }
  for (const warning of result.meta.warnings || []) lines.push(`注意   ${warning}`);
  return lines;
}

export function renderMarkdown(result) {
  const cold = result.cold;
  const warm = result.warm;
  const at = new Date(result.meta.startedAt);
  const lines = [];
  lines.push(`# 链路测量 · ${result.meta.host} · ${at.toISOString().slice(0, 16).replace("T", " ")}`);
  lines.push("");
  lines.push(`- 测点：${result.meta.base}${result.meta.finalUrl !== result.meta.base ? ` → ${new URL(result.meta.finalUrl).pathname}` : ""}`);
  lines.push(`- 测速机：${result.meta.machine}`);
  lines.push(
    `- 参数：冷请求 ${result.meta.samples} · 热请求 ${result.meta.warm} · ${result.meta.streams} 流 / ${fmtBytes(result.meta.bytesTarget)}${
      result.meta.uploadMethod ? ` · 上行 ${result.meta.uploadMethod} ${fmtBytes(result.meta.uploadSize)}` : ""
    }`
  );
  lines.push(`- 测量脚本：${result.meta.git || "-"} · 开始 ${at.toISOString()}`);
  lines.push("");
  lines.push("> 数字包含测速机到目标的公网路径；换机器、换时段、换目标都会变。只和同机、同目标、同时段的另一轮比较。");
  lines.push("");
  lines.push("## 分段");
  lines.push("");
  lines.push("| 指标 | n | p50 | p95 | 最小 | 最大 |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  const row = (label, stats, unit = "ms") =>
    lines.push(
      `| ${label} | ${stats.n} | ${fmt(stats.p50, 1)} ${unit} | ${fmt(stats.p95, 1)} ${unit} | ${fmt(stats.min, 1)} ${unit} | ${fmt(
        stats.max,
        1
      )} ${unit} |`
    );
  row("TCP 建连（含 DNS）", cold.tcp);
  if (cold.tls.n) row("TLS 握手", cold.tls);
  row("冷请求 TTFB", cold.ttfb);
  row("冷请求 total", cold.total);
  if (warm.n) row("热请求 TTFB", warm.ttfb);
  if (result.transport.dnsMs != null) lines.push(`| DNS 解析（一次） | 1 | ${fmt(result.transport.dnsMs, 1)} ms | - | - | - |`);
  lines.push("");
  lines.push("## 吞吐");
  lines.push("");
  lines.push("| 方向 | 端点 | 传输 | 次数 | 用时 | 速率 |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  if (result.download?.ok) {
    lines.push(
      `| 下行 | ${new URL(result.download.url).pathname} | ${fmtBytes(result.download.bytes)} | ${result.download.requests} | ${fmt(
        result.download.elapsedMs / 1000,
        2
      )}s | ${fmt(result.download.mbps, 1)} Mbps（${result.download.streams} 流） |`
    );
  } else {
    lines.push(`| 下行 | 未测 | ${result.download?.reason || "无可用静态资源"} | - | - | - |`);
  }
  if (result.upload?.ok) {
    const rate = result.upload.rateUsable ? `${fmt(result.upload.mbps, 1)} Mbps（${result.upload.streams} 流）` : "-";
    lines.push(
      `| 上行 | ${new URL(result.upload.url).pathname} | ${fmtBytes(result.upload.bytes)} / 每次 ${fmtBytes(result.upload.bodySize)} | ${
        result.upload.requests
      } | ${fmt(result.upload.elapsedMs / 1000, 2)}s | ${rate} |`
    );
  } else {
    lines.push(`| 上行 | ${result.upload?.skipped ? "未测" : "-"} | ${result.upload?.reason || result.upload?.error || "-"} | - | - | - |`);
  }
  lines.push("");
  if (result.upload?.rateUsable && result.upload?.mbps && !result.upload.rttBound) {
    lines.push(
      `上下行之比（下行 ÷ 上行）＝ ${fmt(result.download?.mbps ? result.download.mbps / result.upload.mbps : null, 1)}×。异步链路通常下行远大于上行，差多少是这个部署的常态。`
    );
  }
  if (result.upload?.rateUsable && result.upload?.rttBound) {
    lines.push(
      `> 上行每次只发 ${fmtBytes(result.upload.bodySize)}，样本以一次往返为主，${fmt(result.upload.mbps, 1)}Mbps 主要是「每秒能发几个请求」，不代表上行带宽，也不参与上下行之比。要看带宽把 \`--upload-size\` 调到端点上限附近。`
    );
  }
  if (result.download?.ok || result.upload?.ok) {
    lines.push("两个方向都随 `--streams` 上升，说明限制在每次请求的往返与窗口，不是链路带宽；`--streams 1` 是单流下界。容量上限要另用 `iperf3` 或长时间大文件交叉验证——SSH 单线程加密会低估上行。");
  }
  if (result.upload?.refused) {
    lines.push("");
    lines.push(
      `> 上行有 ${result.upload.refused}/${result.upload.requests} 次在请求体写完前被回绝（状态 ${Object.keys(result.upload.statuses || {}).join(
        "/"
      )}）。这几笔没有把 ${fmtBytes(result.upload.bodySize)} 送完，所以「速率」一栏记的是「-」：这只能说明这个端点不收这么大的体（client_max_body_size 或该路径不接 POST），不是上行只有这么快。`
    );
  }
  if (result.upload?.ok && !result.upload.refused && !result.upload.rateUsable) {
    lines.push("");
    lines.push(
      `> 上行 ${result.upload.requests} 次请求体都写完了，但没有一次被端点收下（状态 ${Object.keys(result.upload.statuses || {}).join(
        "/"
      )}）。请求体只发到 ${fmtBytes(result.upload.bodySize)} 时，它通常还没离开本机就已被内核收下，写它们的时间说明不了这条链路有多快，所以「速率」一栏记的是「-」。`
    );
  }
  lines.push("");
  lines.push("## 链路");
  lines.push("");
  lines.push(`- 协议：${result.transport.protocol || "http"} · ALPN ${result.transport.alpn || "-"}`);
  lines.push(`- 目标响应：${result.target.status} · ${fmtBytes(result.target.bytes)} · ${result.target.contentType || "-"}`);
  if (result.meta.warnings?.length) {
    lines.push("");
    lines.push("## 注意");
    lines.push("");
    for (const warning of result.meta.warnings) lines.push(`- ${warning}`);
  }
  return lines.join("\n");
}

const VALUE_FLAGS = new Set([
  "--path",
  "--download",
  "--samples",
  "--warm",
  "--streams",
  "--bytes",
  "--out",
  "--upload-path",
  "--upload-method",
  "--upload-size",
  "--upload-token-file",
  "--upload-cookie-file",
]);

function positionalArgs(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (VALUE_FLAGS.has(item)) {
      i += 1;
      continue;
    }
    if (item.startsWith("--")) continue;
    out.push(item);
  }
  return out;
}

function readFlag(argv, name, fallback) {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const value = argv[i + 1];
  if (value === undefined || value === "" || value.startsWith("--")) {
    console.error(`--${name} 后面要跟一个值（当前：${value === undefined ? "行尾" : `"${value}"`}）`);
    process.exit(2);
  }
  return value;
}

function readNumber(argv, name, fallback, { min = 1 } = {}) {
  const raw = readFlag(argv, name, String(fallback));
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min) {
    console.error(`--${name} 要是 ≥${min} 的数，收到：${raw}`);
    process.exit(2);
  }
  return Math.floor(value);
}

function parseBytes(raw) {
  const text = String(raw).trim().toLowerCase();
  const match = /^(\d+(?:\.\d+)?)\s*(k|m|g)?b?$/.exec(text);
  if (!match) return null;
  const scale = { k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[match[2] || ""] || 1;
  return Math.round(Number(match[1]) * scale);
}

function resolveBytesTarget(argv) {
  const raw = readFlag(argv, "bytes", "4m");
  const value = parseBytes(raw);
  if (!value || value < 64 * 1024) {
    console.error(`--bytes 要 ≥64k（如 4m），收到：${raw}`);
    process.exit(2);
  }
  return value;
}

// 上行凭据只从环境变量或显式文件读：既打印不出，也写不进结果文件。
// 一份授权码就是一个身份，和 run.mjs 一样接受 `KNOT_AGENT_TOKEN=...` 的写法。
function normalizeToken(raw) {
  const text = String(raw || "").trim();
  const value = text.startsWith("KNOT_AGENT_TOKEN=") ? text.slice(text.indexOf("KNOT_AGENT_TOKEN=") + "KNOT_AGENT_TOKEN=".length) : text;
  return value.trim().replace(/^["']|["']$/g, "");
}

function readFirstLine(file, label) {
  const abs = path.resolve(process.cwd(), file);
  if (!existsSync(abs)) {
    console.error(`${label} 文件不存在：${abs}`);
    process.exit(2);
  }
  const line = readFileSync(abs, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("#"));
  if (!line) {
    console.error(`${label} 文件里没有可用的一行：${abs}`);
    process.exit(2);
  }
  return line;
}

function resolveUploadHeaders(argv) {
  const headers = {};
  const tokenFile = readFlag(argv, "upload-token-file", "");
  const token = tokenFile ? normalizeToken(readFirstLine(tokenFile, "授权码")) : normalizeToken(process.env.BENCH_UPLOAD_TOKEN || "");
  if (token) headers.authorization = `Bearer ${token}`;

  const cookieFile = readFlag(argv, "upload-cookie-file", "");
  const cookie = cookieFile ? readFirstLine(cookieFile, "Cookie") : String(process.env.BENCH_UPLOAD_COOKIE || "").trim();
  if (cookie && !/^cookie:/i.test(cookie)) headers.cookie = cookie;
  else if (cookie) headers.cookie = cookie.slice(cookie.indexOf(":") + 1).trim();

  return { headers, auth: { token: Boolean(token), cookie: Boolean(cookie) } };
}

function latestLink(target) {
  try {
    const latest = path.join(RESULTS_ROOT, "latest-link");
    rmSync(latest, { force: true });
    symlinkSync(target, latest);
  } catch {}
}

async function main() {
  const argv = process.argv.slice(2);
  const base = positionalArgs(argv)[0] || process.env.BENCH_BASE || "";
  if (!base) {
    console.error("用法：node scripts/link.mjs https://<站点> [--path /] [--samples 20] [--warm 20]");
    console.error("      [--streams 8] [--bytes 4m] [--download /assets/x.js] [--out results/link-<时间>]");
    console.error("      [--upload-path /api/agent/uploads] [--upload-size 4m] [--upload-method POST]");
    console.error("      [--upload-token-file <文件>] [--upload-cookie-file <文件>]");
    process.exit(2);
  }
  if (!normalizeBase(base)) {
    console.error(`不是一个可测的 http/https 地址：${base}`);
    process.exit(2);
  }

  const uploadPath = readFlag(argv, "upload-path", String(process.env.BENCH_UPLOAD_PATH || ""));
  if (uploadPath && /^https?:\/\//i.test(uploadPath) && !normalizeBase(uploadPath)) {
    console.error(`--upload-path 作为完整地址时要是 http/https 且不带账号密码：${uploadPath}`);
    process.exit(2);
  }
  const uploadMethod = readFlag(argv, "upload-method", "POST").toUpperCase();
  if (!["POST", "PUT", "PATCH"].includes(uploadMethod)) {
    console.error(`--upload-method 只支持 POST / PUT / PATCH，收到：${uploadMethod}`);
    process.exit(2);
  }
  const uploadSize = parseBytes(readFlag(argv, "upload-size", "4m"));
  if (!uploadSize || uploadSize < 1024) {
    console.error(`--upload-size 要 ≥1k（如 4m），收到：${readFlag(argv, "upload-size", "4m")}`);
    process.exit(2);
  }
  const uploadAuth = resolveUploadHeaders(argv);

  const options = {
    path: readFlag(argv, "path", "/"),
    download: readFlag(argv, "download", ""),
    samples: readNumber(argv, "samples", 20),
    warm: readNumber(argv, "warm", 20, { min: 0 }),
    streams: readNumber(argv, "streams", 8),
    bytesTarget: resolveBytesTarget(argv),
    upload: uploadPath,
    uploadMethod,
    uploadSize,
    uploadHeaders: uploadAuth.headers,
  };

  const result = await measureLink(base, options);
  // 凭据只记「有没有」，值不进结果文件。
  result.meta.uploadAuth = uploadPath ? { token: uploadAuth.auth.token, cookie: uploadAuth.auth.cookie } : null;
  result.meta.uploadMethod = uploadPath ? uploadMethod : null;
  result.meta.uploadSize = uploadPath ? uploadSize : null;
  console.log(summaryLines(result).join("\n"));

  const stamp = result.meta.startedAt.replace(/[:.]/g, "-").slice(0, 19);
  const outDir = path.resolve(ROOT, readFlag(argv, "out", path.join("results", `link-${stamp}`)));
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "link.json"), `${JSON.stringify(result, null, 2)}\n`);
  const markdown = renderMarkdown(result);
  writeFileSync(path.join(outDir, "link.md"), `${markdown}\n`);
  if (outDir.startsWith(RESULTS_ROOT + path.sep)) latestLink(outDir);

  console.log("");
  console.log(markdown);
  console.log("");
  console.log(`结果目录：${outDir}`);

  // 一次都建不起来就不是「慢」，是到不了：退出码要给调用方看出来。
  process.exitCode = result.cold.ok > 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
