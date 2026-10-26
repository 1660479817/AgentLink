// OpenClaw 宿主侧状态：读一份别人写好的文件，不调 CLI、不起进程。
//
// 它刻意不 import agents/openclaw.js——那个模块会真的拉起评审员。这里只回答
// 「这台机器上的 OpenClaw 现在什么状态」，而「审核有没有在干活」由 agentReview.js
// 从库里回答。两条线索分开取，任一条断了另一条照样有数。
//
// 文件位置不新增配置键：进程里已经有部署根；没有就退到授权码目录上三级，
// 与 profileFilePath 同一种推法。推不出来是 null，读不到是 unknown——都不是故障。

import { readFile } from "node:fs/promises";
import path from "node:path";

export const STATUS_STATES = ["ok", "degraded", "off", "unknown"];

// 状态文件的位置。三个回退层次都来自进程已有的值，不猜也不建目录。
export function statusFilePath(env = process.env) {
  const root = String(env.KNOT_DEPLOY_ROOT || "").trim();
  if (root) return path.join(root, "var", "run", "openclaw-status.json");
  const envDir = String(env.KNOT_AGENT_ENV_DIR || "").trim();
  // <部署根>/sites/<站点>/agents → 上三级是部署根。
  if (envDir) return path.resolve(envDir, "..", "..", "..", "var", "run", "openclaw-status.json");
  return null;
}

function num(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function list(value) {
  return Array.isArray(value) ? value.map((entry) => String(entry)) : null;
}

// 只挑白名单字段。状态文件是旁路产物，不把它整包透出去：
// 将来谁在里面多写一个字段，也不该顺着 API 漏出去。
function detailsOf(source) {
  const details = {};
  if (source.version != null) details.version = String(source.version);
  if (source.gateway && typeof source.gateway === "object") {
    details.gateway = { ok: Boolean(source.gateway.ok), port: num(source.gateway.port) };
  }
  if (source.model && typeof source.model === "object") {
    details.model = { configured: Boolean(source.model.configured) };
  }
  if (source.agents && typeof source.agents === "object") {
    details.agents = {
      expected: num(source.agents.expected),
      registered: num(source.agents.registered),
      missing: list(source.agents.missing),
    };
  }
  if (source.cron && typeof source.cron === "object") {
    details.cron = { patrol: typeof source.cron.patrol === "string" ? source.cron.patrol : null };
  }
  return details;
}

function unknown(reason) {
  return { state: "unknown", checkedAt: null, stale: true, reason };
}

export async function readOpenclawStatus(options = {}) {
  const file = options.file == null ? null : String(options.file);
  const now = Number(options.now) || Date.now();
  const maxAgeMs = Number(options.maxAgeMs) || 3 * 5 * 60_000;

  if (!file) return unknown("no_path");

  let text;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return unknown("no_status_file");
    return unknown("bad_status_file");
  }

  let source;
  try {
    source = JSON.parse(text);
  } catch {
    return unknown("bad_status_file");
  }
  if (!source || typeof source !== "object" || Array.isArray(source)) return unknown("bad_status_file");
  if (!STATUS_STATES.includes(source.state)) return unknown("bad_status_file");

  const checkedAt = source.checkedAt ? Date.parse(source.checkedAt) : Number.NaN;
  const iso = Number.isFinite(checkedAt) ? new Date(checkedAt).toISOString() : null;

  // off 是部署写下的事实，不是心跳：它不会「过期」。
  // unknown 从来不是新鲜的。其余状态超过时限就是 stale，页面据此说「这份读数是旧的」。
  if (source.state === "off") return { state: "off", checkedAt: iso, stale: false };
  if (source.state === "unknown") {
    return {
      state: "unknown",
      checkedAt: iso,
      stale: true,
      reason: typeof source.reason === "string" ? source.reason : "reported_unknown",
      ...detailsOf(source),
    };
  }

  return {
    state: source.state,
    checkedAt: iso,
    stale: !(iso && now - checkedAt <= maxAgeMs),
    ...detailsOf(source),
  };
}
