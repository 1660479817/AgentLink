// 中枢的部署脚本里，每一次 curl 都必须直连。
//
// 开发机上常挂着本机代理（http_proxy / https_proxy 指向本地端口）。deploy-api.sh 最后
// 会从这台机器 curl 一次公网地址，用来回答「接口起来之后公网能不能到」。走代理时量的
// 是代理，代理抖一下就会打印「公网地址这次没连上」，把一次成功的部署说成半失败。
//
// 规则：ops/*.sh 里的 curl 一律带 --noproxy '*'。以下几种写法不算，因为它们不是在这台
// 机器上执行、或者只是打印给人看的：heredoc 正文、# 注释、echo / printf，以及 ssh
// 后面引号里的 curl（那条跑在中枢主机上，那边没有这台机器的代理设置）。

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPTS = fileURLToPath(new URL(".", import.meta.url));

// 去掉 heredoc 正文；开 heredoc 的那一行保留引用之前的部分，它自己有时也是真命令。
function codeLines(text) {
  const out = [];
  let delimiter = null;
  text.split("\n").forEach((line, index) => {
    if (delimiter) {
      if (line.trim() === delimiter) delimiter = null;
      return;
    }
    const open = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(line);
    if (open) {
      delimiter = open[2];
      out.push({ no: index + 1, text: line.slice(0, open.index) });
      return;
    }
    out.push({ no: index + 1, text: line });
  });
  return out;
}

// 反斜杠续行拼成一条，--noproxy 写在下半行时才不会被漏看。
function logicalLines(lines) {
  const out = [];
  let buffer = "";
  let start = 0;
  for (const { no, text } of lines) {
    if (!buffer) start = no;
    const joined = buffer ? `${buffer} ${text}` : text;
    if (joined.endsWith("\\")) {
      buffer = joined.slice(0, -1);
      continue;
    }
    out.push({ no: start, text: joined });
    buffer = "";
  }
  if (buffer) out.push({ no: start, text: buffer });
  return out;
}

export function offenders(name, text) {
  const found = [];
  for (const { no, text: line } of logicalLines(codeLines(text))) {
    if (/^\s*#/.test(line)) continue;
    if (/^\s*(echo|printf)\b/.test(line)) continue;
    const at = line.indexOf("curl");
    if (at < 0 || !/\bcurl\b/.test(line)) continue;
    const viaSsh = line.indexOf("ssh ") >= 0 && line.indexOf("ssh ") < at;
    if (viaSsh) continue;
    if (line.includes("--noproxy")) continue;
    found.push({ file: name, no, text: line.trim() });
  }
  return found;
}

test("every curl in the hub deploy scripts goes direct", () => {
  const scripts = readdirSync(SCRIPTS)
    .filter((name) => name.endsWith(".sh"))
    .sort()
    .map((name) => ({ name, text: readFileSync(new URL(name, `file://${SCRIPTS}`), "utf8") }));
  const found = scripts.flatMap(({ name, text }) => offenders(name, text));
  assert.deepEqual(
    found,
    [],
    `这些 curl 会走本机代理：\n${found.map((entry) => `  ${entry.file}:${entry.no}  ${entry.text}`).join("\n")}`
  );
});

test("the rule catches the public health check that used to go through the proxy", () => {
  const before = '      curl -sf "https://xknot.si/api/health" >/dev/null 2>&1 \\';
  assert.equal(offenders("deploy-api.sh", before).length, 1);

  const after = '      curl -sf --noproxy \'*\' "https://xknot.si/api/health" >/dev/null 2>&1 \\';
  assert.equal(offenders("deploy-api.sh", after).length, 0);
});

test("printed text and remote commands are not calls on this machine", () => {
  const text = [
    '  echo "(dry-run) curl $XKNOT_HUB_SSH/api/health; check xknot-health.timer"',
    '    if ssh "$HUB" "curl -sf http://127.0.0.1:5181/api/health"; then',
    "# curl -sf https://xknot.si/api/health",
  ].join("\n");
  assert.deepEqual(offenders("deploy-api.sh", text), []);
});
