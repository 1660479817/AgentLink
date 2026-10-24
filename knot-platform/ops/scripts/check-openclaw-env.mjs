#!/usr/bin/env node
// 安装前检查 OpenClaw 环境：是否安装、版本是否达标、模型是否配置。只提醒，不阻断。
// 部署脚本在安装前调用，也可手动跑：node ops/scripts/check-openclaw-env.mjs
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// 最低版本。按 OpenClaw 的日期式版本（如 2026.10.1）逐段比较；拿不准就调高。
const MIN_VERSION = process.env.KNOT_OPENCLAW_MIN_VERSION || "2026.10.1";

function warn(...args) {
  process.stderr.write(`警告：${args.join(" ")}\n`);
}

function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i += 1) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

// 1. 是否安装 + 版本
let version = "";
let installed = true;
try {
  const out = execFileSync("openclaw", ["--version"], { encoding: "utf8" }).trim();
  version = (out.match(/\d{4}\.\d+\.\d+/) || [""])[0];
} catch {
  installed = false;
}

if (!installed) {
  warn("未安装 OpenClaw。审核 / 管理 / 检索智能体靠它运行；不装则 Knot 只跑基础内容流水线。");
  warn("  安装：npm install -g openclaw@latest");
} else if (!version) {
  warn("读不到 OpenClaw 版本，openclaw --version 输出无法解析。");
} else if (compareVersions(version, MIN_VERSION) < 0) {
  warn(`OpenClaw 版本 ${version} 低于最低要求 ${MIN_VERSION}（可用 KNOT_OPENCLAW_MIN_VERSION 覆盖）。`);
}

// 2. 模型是否配置：有 provider 声明了模型清单、且配了凭据，才算配好。
const file = path.join(os.homedir(), ".openclaw", "openclaw.json");
let hasModel = false;
let hasAuth = false;
let missing = true;
try {
  const cfg = JSON.parse(readFileSync(file, "utf8"));
  missing = false;
  const providers = (cfg.models && cfg.models.providers) || {};
  hasModel = Object.values(providers).some((p) => Array.isArray(p.models) && p.models.length > 0);
  hasAuth = !!(cfg.auth && cfg.auth.profiles && Object.keys(cfg.auth.profiles).length > 0);
} catch {
  // 文件不存在或读不了：按未配置处理。
}

if (missing) {
  warn(`没有 ${file}，模型尚未配置。`);
} else {
  if (!hasModel) warn("OpenClaw 没有声明带模型清单的 provider（models.providers 为空）。");
  if (!hasAuth) warn("OpenClaw 没有配置凭据（auth.profiles 为空）。");
}
