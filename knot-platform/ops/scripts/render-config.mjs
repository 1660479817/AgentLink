#!/usr/bin/env node
// 部署模板渲染。
//
//   node ops/scripts/render-config.mjs ops/entry/site.conf.template /tmp/site.conf
//
// 只支持两种语法，故意保持很小：
//   {{NAME}}              替换成环境变量 NAME
//   {{#NAME}}…{{/NAME}}   NAME 为真时保留中间一段
//   {{^NAME}}…{{/NAME}}   NAME 为假时保留中间一段
//
// 变量未定义会直接报错，避免模板拼错后悄悄生成一份缺项的 nginx 配置。

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { invokedDirectly } from "./lib/main-module.mjs";

const TOKEN = /\{\{([#^/]?)([A-Za-z0-9_]+)\}\}/g;

// 模板变量会被原样写进 nginx 配置。一个含 `;` 或换行的值就能结束当前指令、
// 再插一条自己的（自由文本键最容易）。这里按「值只占一个 token」来约束：
// 控制字符、分号、花括号、引号和反斜杠一律拒绝，路径与域名照常通过。
const UNSAFE_VALUE = /[\x00-\x1f\x7f;{}"'\\]/;

export function checkValue(name, value) {
  const text = String(value ?? "");
  if (UNSAFE_VALUE.test(text)) {
    throw new Error(
      `模板变量 ${name} 的值里有会破坏配置的字符（控制字符、; { } 引号或反斜杠）：${JSON.stringify(text)}`
    );
  }
  return text;
}

export function isTruthy(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return false;
  return !["0", "false", "no", "off"].includes(text);
}

function sectionEnd(template, from, name) {
  TOKEN.lastIndex = from;
  let depth = 0;
  for (let match = TOKEN.exec(template); match; match = TOKEN.exec(template)) {
    const [, marker, tokenName] = match;
    if (tokenName !== name) continue;
    if (marker === "#" || marker === "^") depth += 1;
    if (marker !== "/") continue;
    if (depth === 0) return { inner: [from, match.index], end: TOKEN.lastIndex };
    depth -= 1;
  }
  throw new Error(`模板缺少 {{/${name}}}`);
}

export function renderTemplate(template, env = process.env) {
  let out = "";
  let cursor = 0;
  TOKEN.lastIndex = 0;
  for (let match = TOKEN.exec(template); match; match = TOKEN.exec(template)) {
    out += template.slice(cursor, match.index);
    const [, marker, name] = match;
    if (marker === "/") throw new Error(`模板多了一个 {{/${name}}}`);
    if (marker === "#" || marker === "^") {
      const { inner, end } = sectionEnd(template, TOKEN.lastIndex, name);
      const keep = isTruthy(env[name]) === (marker === "#");
      if (keep) out += renderTemplate(template.slice(inner[0], inner[1]), env);
      cursor = end;
      TOKEN.lastIndex = end;
      continue;
    }
    if (!Object.hasOwn(env, name)) throw new Error(`模板变量未定义：${name}`);
    out += checkValue(name, env[name]);
    cursor = TOKEN.lastIndex;
  }
  out += template.slice(cursor);
  return out;
}

export function renderFile(templatePath, env = process.env) {
  return renderTemplate(readFileSync(templatePath, "utf8"), env);
}

function main(argv) {
  const [templatePath, dest = "-", ...rest] = argv;
  if (!templatePath || rest.length) {
    console.error("用法：render-config.mjs <template> [dest|-]");
    process.exit(2);
  }
  let text;
  try {
    text = renderFile(templatePath);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  if (dest === "-") {
    process.stdout.write(text);
    return;
  }
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, text);
}

// 部署机上脚本从 <部署根>/current 调用，那条路径是软链：判断要比真实路径。
if (invokedDirectly(import.meta.url)) {
  main(process.argv.slice(2));
}
