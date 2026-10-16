#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "http://127.0.0.1:8080";
const HINTS = {
  bad_token: "正在跑的 Backend 握着另一把令牌，等它重新读入 KNOT_ADMIN_TOKEN 后再调。",
  admin_unconfigured: "Backend 进程里还没有这把令牌。等它读入 KNOT_ADMIN_TOKEN 后再调。",
};

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

async function request(spec, { token, fetchImpl, baseUrl }) {
  let response;
  try {
    response = await fetchImpl(new URL(spec.path, baseUrl), {
      method: spec.method,
      headers: { Authorization: `Bearer ${token}` },
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
  const [command, ...rest] = argv;
  if (command !== "economy") {
    return { code: 1, body: { error: "bad_args", hint: "只有 economy 这一条命令。" } };
  }
  if (rest.length) {
    return { code: 1, body: { error: "bad_args", hint: "economy 不带参数。" } };
  }
  const token =
    options.token != null
      ? String(options.token).trim()
      : await readAdminToken(
          options.tokenFiles || tokenCandidates(options.cwd || process.cwd(), options.scriptFile || fileURLToPath(import.meta.url)),
          options.readFile,
        );
  if (!token) return { code: 1, body: { error: "admin_unconfigured", hint: "管理接口还没配好。" } };
  return request(
    { method: "GET", path: "/api/admin/economy" },
    { token, fetchImpl: options.fetch || globalThis.fetch, baseUrl: options.baseUrl || BASE }
  );
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
