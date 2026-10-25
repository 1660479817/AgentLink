import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

import { mbpsOf, measureLink, measureUpload, percentile, pickDownloadPath, requestOnce, renderMarkdown, statsOf, summaryLines, uploadOnce } from "./link.mjs";

test("percentile 用最近秩，不插值", () => {
  assert.equal(percentile([10, 20, 30, 40], 50), 20);
  assert.equal(percentile([10, 20, 30, 40], 95), 40);
  assert.equal(percentile([5], 95), 5);
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([1, null, 3], 50), 1);
});

test("statsOf 空样本不产出 0", () => {
  assert.deepEqual(statsOf([]), { n: 0, p50: null, p95: null, min: null, max: null });
  const stats = statsOf([3, 1, 2]);
  assert.equal(stats.n, 3);
  assert.equal(stats.p50, 2);
  assert.equal(stats.min, 1);
  assert.equal(stats.max, 3);
});

test("pickDownloadPath 优先 JS，其次 CSS，都没有就留空", () => {
  assert.equal(pickDownloadPath('<script src="/assets/a.js"></script><link href="/assets/a.css">'), "/assets/a.js");
  assert.equal(pickDownloadPath('<link href="/assets/a.css">'), "/assets/a.css");
  assert.equal(pickDownloadPath("<html></html>"), "");
});

test("mbpsOf 按十进制兆比特算，输入不全会返回空", () => {
  assert.equal(mbpsOf(1_000_000, 1000), 8);
  assert.equal(mbpsOf(0, 1000), 0);
  assert.equal(mbpsOf(-1, 1000), -0.000008);
  assert.equal(mbpsOf(null, 1000), null);
  assert.equal(mbpsOf(100, 0), null);
});

test("requestOnce 对坏地址回失败，不抛异常", async () => {
  const result = await requestOnce("not a url");
  assert.equal(result.ok, false);
  assert.match(result.error, /bad_url/);
});

test("measureLink 在本地 HTTP 服务上跑通冷、热、吞吐", async (t) => {
  const server = createServer((req, res) => {
    if (req.url === "/") {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end('<!doctype html><html><body><script src="/assets/app.js"></script></body></html>');
      return;
    }
    if (req.url === "/assets/app.js") {
      res.setHeader("content-type", "application/javascript");
      res.end("x".repeat(64 * 1024));
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections?.();
    server.close();
  });
  const { port } = server.address();

  const result = await measureLink(`http://127.0.0.1:${port}`, {
    samples: 3,
    warm: 2,
    streams: 2,
    bytesTarget: 128 * 1024,
    timeoutMs: 5000,
    deadlineMs: 5000,
  });

  assert.equal(result.target.status, 200);
  assert.equal(result.cold.n, 3);
  assert.equal(result.cold.ok, 3);
  assert.equal(result.cold.statuses[200], 3);
  assert.ok(result.cold.ttfb.p50 >= 0);
  assert.ok(result.cold.total.p50 >= result.cold.ttfb.p50);
  assert.equal(result.warm.n, 2);
  assert.equal(result.download.ok, true);
  assert.equal(result.download.assetBytes, 64 * 1024);
  assert.ok(result.download.bytes >= 128 * 1024);
  assert.ok(result.download.mbps > 0);
  assert.equal(result.meta.warnings.filter((w) => w.includes("冷请求失败")).length, 0);
});

test("冷请求全是 503 时提示限流，不当成链路慢", async (t) => {
  const server = createServer((req, res) => {
    res.statusCode = 503;
    res.end("busy");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections?.();
    server.close();
  });
  const { port } = server.address();

  const result = await measureLink(`http://127.0.0.1:${port}`, {
    samples: 2,
    warm: 0,
    streams: 1,
    bytesTarget: 64 * 1024,
    timeoutMs: 2000,
    deadlineMs: 1000,
  });

  assert.equal(result.cold.ok, 0);
  assert.equal(result.cold.ttfb.p50, null);
  assert.ok(result.meta.warnings.some((w) => w.includes("429/503")));
  assert.equal(result.download.ok, false);
});

test("上行：端点把请求体读完才回，字节与速率都算真数", async (t) => {
  const seen = [];
  const server = createServer((req, res) => {
    let bytes = 0;
    req.on("data", (chunk) => {
      bytes += chunk.length;
    });
    req.on("end", () => {
      seen.push({ url: req.url, bytes, auth: req.headers.authorization || "" });
      res.setHeader("content-type", "application/json");
      res.end('{"ok":true}');
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections?.();
    server.close();
  });
  const { port } = server.address();

  const result = await measureUpload(`http://127.0.0.1:${port}/api/agent/uploads`, {
    streams: 2,
    bytesTarget: 256 * 1024,
    size: 128 * 1024,
    headers: { authorization: "Bearer test-token" },
    timeoutMs: 5000,
    deadlineMs: 5000,
  });

  assert.equal(result.ok, true);
  assert.equal(result.refused, 0);
  assert.equal(result.bytes, 256 * 1024);
  assert.equal(result.requests, 2);
  assert.equal(result.accepted, 2);
  assert.ok(result.mbps > 0);
  assert.equal(result.bodySize, 128 * 1024);
  assert.ok(seen.every((entry) => entry.bytes === 128 * 1024));
  assert.ok(seen.every((entry) => entry.auth === "Bearer test-token"));
});

test("上行：端点读完前就回 413，记成「拒收」，不说成带宽", async (t) => {
  const server = createServer((req, res) => {
    // 不读请求体，立刻拒收并断连：模拟 client_max_body_size 太小。
    res.statusCode = 413;
    res.end("too large");
    req.destroy();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections?.();
    server.close();
  });
  const { port } = server.address();

  const result = await measureUpload(`http://127.0.0.1:${port}/api/health`, {
    streams: 1,
    bytesTarget: 1024 * 1024,
    size: 1024 * 1024,
    timeoutMs: 3000,
    deadlineMs: 3000,
  });

  assert.equal(result.refused >= 1, true);
  assert.equal(result.accepted, 0);
  assert.equal(result.complete, false);
});

test("上行：全部被拒绝时不报速率，只说明没被收下", async (t) => {
  // 真实的坑：POST 到 /api/agent/uploads 而不带鉴权，64KB 的体写完就被 400 回绝。
  // 字节数看着是真的（每次都写完了），但那 64KB 可能一直躺在内核缓冲里，
  // 服务端一个字节都没读。写它的时间只能说明「塞进 socket 有多快」。
  const server = createServer((req, res) => {
    res.statusCode = 400;
    res.end('{"error":"bad_request"}');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections?.();
    server.close();
  });
  const { port } = server.address();

  const upload = await measureUpload(`http://127.0.0.1:${port}/api/agent/uploads`, {
    streams: 2,
    bytesTarget: 128 * 1024,
    size: 64 * 1024,
    timeoutMs: 3000,
    deadlineMs: 3000,
  });

  assert.equal(upload.ok, true);
  assert.equal(upload.accepted, 0);
  assert.equal(upload.refused, 0);
  assert.equal(upload.rateUsable, false);
  assert.deepEqual(upload.statuses, { 400: 2 });
  // 字节数与次数照记，只是不折算成速率。
  assert.equal(upload.bytes, 128 * 1024);

  const result = {
    meta: { base: "http://x/", finalUrl: "http://x/", host: "x", machine: "m", startedAt: "2026-01-01T00:00:00.000Z", samples: 1, warm: 0, streams: 2, bytesTarget: 1, warnings: [] },
    target: { url: "http://x/", status: 200, bytes: 1, contentType: "text/html", hops: 0 },
    transport: { protocol: "http", alpn: null, dnsMs: null, dnsError: "" },
    cold: { n: 0, ok: 0, statuses: {}, tcp: statsOf([]), tls: statsOf([]), ttfb: statsOf([]), total: statsOf([]) },
    warm: { n: 0, ok: 0, ttfb: statsOf([]) },
    download: { ok: false, skipped: true, reason: "未测" },
    upload,
  };
  const summary = summaryLines(result).join("\n");
  assert.match(summary, /上行\s+无速率/);
  assert.doesNotMatch(summary, /Mbps/);
  const markdown = renderMarkdown(result);
  assert.match(markdown, /\| 上行 \|[^|]*\|[^|]*\|[^|]*\|[^|]*\| - \|/);
  assert.match(markdown, /没有一次被端点收下/);
});

test("上行：请求体太小时标成往返受限，不冒充带宽", async (t) => {
  const server = createServer((req, res) => {
    req.resume();
    req.on("end", () => res.end("{}"));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections?.();
    server.close();
  });
  const { port } = server.address();

  const result = await measureUpload(`http://127.0.0.1:${port}/api/health`, {
    streams: 1,
    bytesTarget: 32 * 1024,
    size: 16 * 1024,
    timeoutMs: 3000,
    deadlineMs: 3000,
  });

  assert.equal(result.rateUsable, true);
  assert.equal(result.rttBound, true);

  const big = await measureUpload(`http://127.0.0.1:${port}/api/health`, {
    streams: 1,
    bytesTarget: 512 * 1024,
    size: 512 * 1024,
    timeoutMs: 3000,
    deadlineMs: 3000,
  });
  assert.equal(big.rttBound, false);
});

test("measureLink 不给 --upload-path 时明确跳过上行", async (t) => {
  const server = createServer((req, res) => {
    res.setHeader("content-type", "text/html");
    res.end('<!doctype html><html><body><script src="/assets/app.js"></script></body></html>');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections?.();
    server.close();
  });
  const { port } = server.address();

  const result = await measureLink(`http://127.0.0.1:${port}`, { samples: 1, warm: 0, streams: 1, bytesTarget: 64 * 1024, timeoutMs: 3000, deadlineMs: 3000 });
  assert.equal(result.upload.skipped, true);
  assert.match(result.upload.reason, /upload-path/);
});

test("measureLink 对不可达地址返回失败结果，不当成 0ms", async () => {
  const result = await measureLink("http://127.0.0.1:1", { samples: 2, warm: 1, timeoutMs: 1000, deadlineMs: 1000 });
  assert.equal(result.cold.ok, 0);
  assert.equal(result.cold.ttfb.p50, null);
  assert.equal(result.download.ok, false);
});
