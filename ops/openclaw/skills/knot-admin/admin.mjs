#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "http://127.0.0.1:8080";
const REPEAT = new Set(["grant", "revoke"]);
const IMAGE_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};
const HINTS = {
  bad_token: "正在跑的 Backend 握着另一把令牌，等它重新读入 KNOT_ADMIN_TOKEN 后再调。",
  admin_unconfigured: "Backend 进程里还没有这把令牌。等它读入 KNOT_ADMIN_TOKEN 后再调。",
};

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

function numberOrRaw(value) {
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    const number = Number(value);
    if (Number.isSafeInteger(number)) return number;
  }
  return value;
}

function query(entries) {
  return Object.fromEntries(Object.entries(entries).filter(([, value]) => value != null && value !== ""));
}

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!command) return fail("bad_args", "缺少命令");
  const flags = {};
  for (let i = 0; i < rest.length; i += 1) {
    const item = rest[i];
    if (!item.startsWith("--") || item === "--") return fail("bad_args", `无法识别 ${item}`);
    const eq = item.indexOf("=");
    let key;
    let value;
    if (eq >= 0) {
      key = item.slice(2, eq);
      value = item.slice(eq + 1);
    } else {
      key = item.slice(2);
      value = rest[i + 1];
      if (value == null || value.startsWith("--")) return fail("bad_args", `缺少 --${key}`);
      i += 1;
    }
    if (!key) return fail("bad_args", "参数名是空的");
    if (REPEAT.has(key)) {
      flags[key] ??= [];
      flags[key].push(value);
    } else if (Object.hasOwn(flags, key)) {
      return fail("bad_args", `--${key} 写了多次`);
    } else {
      flags[key] = value;
    }
  }
  return { command, flags };
}

function withOptionals(json, flags, names) {
  for (const name of names) {
    if (Object.hasOwn(flags, name)) json[name] = flags[name];
  }
  return json;
}

export function buildRequest(command, flags) {
  if (command === "users") {
    return need(flags, ["q"]) || only(flags, ["q"]) || { method: "GET", path: "/api/admin/users", query: { q: flags.q } };
  }
  if (command === "posts") {
    return (
      need(flags, ["user"]) ||
      only(flags, ["user", "q", "within"]) || {
        method: "GET",
        path: "/api/admin/posts",
        query: query({ user: flags.user, q: flags.q, within: flags.within }),
      }
    );
  }
  if (command === "remove") {
    return (
      need(flags, ["id", "reason"]) ||
      only(flags, ["id", "reason"]) || {
        method: "POST",
        path: `/api/admin/posts/${encodeURIComponent(flags.id)}/remove`,
        json: { reason: flags.reason },
      }
    );
  }
  if (command === "warn") {
    return (
      need(flags, ["user", "body"]) ||
      only(flags, ["user", "body"]) || { method: "POST", path: "/api/admin/warnings", json: { user: flags.user, body: flags.body } }
    );
  }
  if (command === "points") {
    return (
      need(flags, ["user", "amount", "body"]) ||
      only(flags, ["user", "amount", "body"]) || {
        method: "POST",
        path: "/api/admin/points",
        json: { user: flags.user, amount: numberOrRaw(flags.amount), body: flags.body },
      }
    );
  }
  if (command === "mute") {
    return (
      need(flags, ["user", "until", "body"]) ||
      only(flags, ["user", "until", "body"]) || {
        method: "POST",
        path: "/api/admin/mute",
        json: { user: flags.user, until: flags.until, body: flags.body },
      }
    );
  }
  if (command === "unmute") {
    return (
      need(flags, ["user", "body"]) ||
      only(flags, ["user", "body"]) || { method: "POST", path: "/api/admin/unmute", json: { user: flags.user, body: flags.body } }
    );
  }
  if (command === "entitlements") {
    return (
      need(flags, ["user", "body"]) ||
      only(flags, ["user", "grant", "revoke", "body"]) || {
        method: "POST",
        path: "/api/admin/entitlements",
        json: { user: flags.user, grant: flags.grant || [], revoke: flags.revoke || [], body: flags.body },
      }
    );
  }
  if (command === "level") {
    return (
      need(flags, ["user", "level", "body"]) ||
      only(flags, ["user", "level", "body"]) || {
        method: "POST",
        path: "/api/admin/level",
        json: { user: flags.user, level: numberOrRaw(flags.level), body: flags.body },
      }
    );
  }
  if (command === "sponsors") {
    return only(flags, []) || { method: "GET", path: "/api/admin/sponsors" };
  }
  if (command === "sponsor-add") {
    return (
      need(flags, ["title", "href"]) ||
      only(flags, ["title", "href", "image", "caption", "source"]) || {
        method: "POST",
        path: "/api/admin/sponsors",
        json: withOptionals({ title: flags.title, href: flags.href }, flags, ["image", "caption", "source"]),
      }
    );
  }
  if (command === "sponsor-edit") {
    const missing = need(flags, ["id"]) || only(flags, ["id", "title", "href", "image", "caption", "source"]);
    if (missing) return missing;
    const json = withOptionals({}, flags, ["title", "href", "image", "caption", "source"]);
    if (!Object.keys(json).length) return fail("bad_args", "至少改一项");
    return { method: "POST", path: `/api/admin/sponsors/${encodeURIComponent(flags.id)}`, json };
  }
  if (command === "sponsor-remove") {
    return need(flags, ["id"]) || only(flags, ["id"]) || { method: "POST", path: `/api/admin/sponsors/${encodeURIComponent(flags.id)}/remove` };
  }
  if (command === "sponsor-place") {
    return (
      need(flags, ["id", "position"]) ||
      only(flags, ["id", "position"]) || {
        method: "POST",
        path: `/api/admin/sponsors/${encodeURIComponent(flags.id)}/place`,
        json: { position: numberOrRaw(flags.position) },
      }
    );
  }
  if (command === "upload") {
    return need(flags, ["file"]) || only(flags, ["file"]) || { method: "POST", path: "/api/admin/uploads", file: flags.file };
  }
  if (command === "patrol") {
    return only(flags, []) || { method: "GET", path: "/api/admin/patrol" };
  }
  if (command === "patrol-record") {
    return need(flags, ["body"]) || only(flags, ["body"]) || { method: "POST", path: "/api/admin/patrol", json: { body: flags.body } };
  }
  return fail("bad_args", `没有命令 ${command}`);
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

function withHint(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const hint = HINTS[payload.error];
  if (!hint || payload.hint) return payload;
  return { ...payload, hint };
}

async function request(spec, { token, fetchImpl, baseUrl, read }) {
  const url = new URL(spec.path, baseUrl);
  for (const [key, value] of Object.entries(spec.query || {})) {
    if (value != null && value !== "") url.searchParams.set(key, String(value));
  }
  const headers = { Authorization: `Bearer ${token}` };
  let body;
  if (spec.json) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(spec.json);
  } else if (spec.file) {
    let bytes;
    try {
      bytes = await read(spec.file);
    } catch (error) {
      if (error.code === "ENOENT") return { code: 1, body: { error: "bad_args", hint: "找不到这张图。" } };
      throw error;
    }
    const name = path.basename(spec.file);
    const type = IMAGE_TYPES[path.extname(name).toLowerCase()] || "application/octet-stream";
    const form = new FormData();
    form.append("file", new Blob([bytes], { type }), name);
    body = form;
  }
  let response;
  try {
    response = await fetchImpl(url, { method: spec.method, headers, body, signal: AbortSignal.timeout(20_000) });
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
  const parsed = parseArgs(argv);
  if (parsed.error) return { code: 1, body: parsed.error };
  const token =
    options.token != null
      ? String(options.token).trim()
      : await readAdminToken(
          options.tokenFiles || tokenCandidates(options.cwd || process.cwd(), options.scriptFile || fileURLToPath(import.meta.url)),
          options.readFile,
        );
  if (!token) return { code: 1, body: { error: "admin_unconfigured", hint: "管理接口还没配好。" } };
  const spec = buildRequest(parsed.command, parsed.flags);
  if (spec.error) return { code: 1, body: spec.error };
  return request(spec, {
    token,
    fetchImpl: options.fetch || globalThis.fetch,
    baseUrl: options.baseUrl || BASE,
    read: options.readFile || readFile,
  });
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
