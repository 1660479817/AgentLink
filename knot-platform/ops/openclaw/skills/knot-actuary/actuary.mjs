#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "http://127.0.0.1:8080";
const HINTS = {
  bad_token: "正在跑的 Backend 握着另一把令牌，等它重新读入 KNOT_ADMIN_TOKEN 后再调。",
  admin_unconfigured: "Backend 进程里还没有这把令牌。等它读入 KNOT_ADMIN_TOKEN 后再调。",
  bad_price: "价格要是范围内的整数。默认价落在上下限之间，上下限和封顶、每积分美分数不超过 100000，每 MB 服务费不超过 1000。",
  not_pending: "这份提议已经写入或已经收回。先重新提议。",
  not_found: "没有这份提议。",
};
const PRICE_FLAGS = ["default", "min", "max", "publish-fee", "download-fee", "cap", "usd-cents", "retrieval"];

function withHint(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const hint = HINTS[payload.error];
  if (!hint || payload.hint) return payload;
  return { ...payload, hint };
}

export function tokenCandidates(cwd, scriptFile) {
  const candidates = [path.resolve(cwd, ".admin-token")];
  const skillDir = path.dirname(scriptFile);
  if (path.basename(path.dirname(skillDir)) === "skills") {
    candidates.push(path.resolve(skillDir, "..", "..", ".admin-token"));
  }
  return [...new Set(candidates)];
}

export async function readAdminToken(files, read = readFile) {
  for (const file of files) {
    try {
      const text = String(await read(file, "utf8")).trim();
      if (text) return text;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return "";
}

function fail(error, hint) {
  return { error: { error, hint } };
}

function need(flags, names) {
  for (const name of names) {
    if (flags[name] == null || flags[name] === "") return fail("bad_args", `缺少 --${name}`);
  }
  return null;
}

function only(flags, names) {
  for (const name of Object.keys(flags)) {
    if (!names.includes(name)) return fail("bad_args", `没有 --${name}`);
  }
  return null;
}

function whole(value) {
  if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)) {
    const number = Number(value);
    if (Number.isSafeInteger(number)) return number;
  }
  return value;
}

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith("--") || item === "--") return fail("bad_args", `无法识别 ${item}`);
    const eq = item.indexOf("=");
    let key;
    let value;
    if (eq >= 0) {
      key = item.slice(2, eq);
      value = item.slice(eq + 1);
    } else {
      key = item.slice(2);
      value = argv[i + 1];
      if (value == null || value.startsWith("--")) return fail("bad_args", `缺少 --${key}`);
      i += 1;
    }
    if (!key) return fail("bad_args", "参数名是空的");
    if (Object.hasOwn(flags, key)) return fail("bad_args", `--${key} 写了多次`);
    flags[key] = value;
  }
  return { flags };
}

export function buildRequest(argv) {
  const [command, ...rest] = argv;
  if (!command) return fail("bad_args", "缺少命令。命令是 economy、prices、propose 或 apply。");
  if (command === "economy") {
    if (rest.length) return fail("bad_args", "economy 不带参数。");
    return { method: "GET", path: "/api/admin/economy" };
  }
  if (command === "prices") {
    if (rest.length) return fail("bad_args", "prices 不带参数。");
    return { method: "GET", path: "/api/admin/prices" };
  }
  if (command === "propose" || command === "apply") {
    const parsed = parseFlags(rest);
    if (parsed.error) return parsed;
    if (command === "apply") {
      return (
        need(parsed.flags, ["id"]) ||
        only(parsed.flags, ["id"]) || {
          method: "POST",
          path: `/api/admin/prices/proposals/${encodeURIComponent(parsed.flags.id)}/apply`,
        }
      );
    }
    return (
      need(parsed.flags, PRICE_FLAGS) ||
      only(parsed.flags, PRICE_FLAGS) || {
        method: "POST",
        path: "/api/admin/prices/proposals",
        json: {
          defaultPrice: whole(parsed.flags.default),
          priceMin: whole(parsed.flags.min),
          priceMax: whole(parsed.flags.max),
          publishServiceFeePerMb: whole(parsed.flags["publish-fee"]),
          downloadServiceFeePerMb: whole(parsed.flags["download-fee"]),
          serviceFeeCap: whole(parsed.flags.cap),
          pointUsdCents: whole(parsed.flags["usd-cents"]),
          retrievalPrice: whole(parsed.flags.retrieval),
        },
      }
    );
  }
  return fail("bad_args", "命令是 economy、prices、propose 或 apply。");
}

async function request(spec, { token, fetchImpl, baseUrl }) {
  const headers = { Authorization: `Bearer ${token}` };
  let body;
  if (spec.json) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(spec.json);
  }
  let response;
  try {
    response = await fetchImpl(new URL(spec.path, baseUrl), {
      method: spec.method,
      headers,
      body,
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return { code: 1, body: { error: "unreachable", hint: "管理接口不在。" } };
  }
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { error: "bad_response", hint: "管理接口没有返回 JSON。" };
  }
  const code = response.status >= 200 && response.status < 300 ? 0 : 1;
  return { code, body: withHint(payload) };
}

export async function execute(argv, options = {}) {
  const spec = buildRequest(argv);
  if (spec.error) return { code: 1, body: spec.error };
  const token =
    options.token != null
      ? String(options.token).trim()
      : await readAdminToken(
          options.tokenFiles || tokenCandidates(options.cwd || process.cwd(), options.scriptFile || fileURLToPath(import.meta.url)),
          options.readFile,
        );
  if (!token) return { code: 1, body: { error: "admin_unconfigured", hint: "管理接口还没配好。" } };
  return request(spec, { token, fetchImpl: options.fetch || globalThis.fetch, baseUrl: options.baseUrl || BASE });
}

// 路径里可能有软链（macOS 的 /tmp 就是），两边都取真实路径再比，
// 否则命令会一声不响地什么都不做。
export function isEntry(moduleFile, argv = process.argv) {
  const arg = argv[1];
  if (!arg) return false;
  try {
    return realpathSync(arg) === realpathSync(moduleFile);
  } catch {
    return false;
  }
}

if (isEntry(fileURLToPath(import.meta.url))) {
  const result = await execute(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result.body, null, 2)}\n`);
  process.exit(result.code);
}
