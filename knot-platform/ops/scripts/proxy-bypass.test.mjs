// 部署脚本里的每一次 curl 都必须直连。
//
// 开发机上常挂着本机代理（http_proxy / https_proxy 指向本地端口）。这对浏览器是对的，
// 对部署脚本是灾难：
//
//   - 验收这一步不过会自动回滚。代理抖一次，正在跑的新版本就会被判成坏的、回滚掉，
//     而且回滚之后用同一个 curl 复验，会报「回滚后仍不可达」——两句都是假话。
//   - 探活与回滚等待都打 127.0.0.1。no_proxy 没列回环的机器上，这些请求会先发给代理。
//
// 所以规则只有一条：这些脚本里的 curl 一律带 --noproxy '*'；测速脚本用 PROXY_OPT，
// 默认同样是 '*'，只有显式 --proxy 才换成空数组（它要量的就是代理链路）。
//
// 这里不做语义分析，只看这条线在不在。几种写法是打印给人看的文本或跑在远端，不算：
// heredoc 正文、以 # 开头的行、echo / printf，以及 ssh 后面引号里的 curl。

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPTS = fileURLToPath(new URL(".", import.meta.url));

// 去掉 heredoc 正文：那些是 cat <<EOF 打印给人看的示例，不是要执行的命令。
// 开 heredoc 的那一行保留引用之前的部分——它自己有时也是一条真命令。
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

// 反斜杠续行拼成一条，否则 --noproxy 写在下半行时会被漏看。
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

function direct(line) {
  return line.includes("--noproxy") || line.includes("PROXY_OPT");
}

export function offenders(name, text) {
  const found = [];
  for (const { no, text: line } of logicalLines(codeLines(text))) {
    if (/^\s*#/.test(line)) continue;
    if (/^\s*(echo|printf)\b/.test(line)) continue;
    const at = line.indexOf("curl");
    if (at < 0 || !/\bcurl\b/.test(line)) continue;
    // ssh 后面的 curl 在远端跑，那边没有这台机器的代理设置。
    const viaSsh = line.indexOf("ssh ") >= 0 && line.indexOf("ssh ") < at;
    if (viaSsh) continue;
    if (direct(line)) continue;
    found.push({ file: name, no, text: line.trim() });
  }
  return found;
}

function scripts() {
  return readdirSync(SCRIPTS)
    .filter((name) => name.endsWith(".sh"))
    .sort()
    .map((name) => ({ name, text: readFileSync(new URL(name, `file://${SCRIPTS}`), "utf8") }));
}

test("every curl in the deploy scripts goes direct", () => {
  const found = scripts().flatMap(({ name, text }) => offenders(name, text));
  assert.deepEqual(
    found,
    [],
    `这些 curl 会走本机代理：\n${found.map((entry) => `  ${entry.file}:${entry.no}  ${entry.text}`).join("\n")}`
  );
});

test("the rule catches a call that would use the proxy", () => {
  const plain = '  if curl -sf "$URL" >/dev/null 2>&1; then';
  assert.equal(offenders("demo.sh", plain).length, 1);

  const fixed = '  if curl -sf --noproxy \'*\' "$URL" >/dev/null 2>&1; then';
  assert.equal(offenders("demo.sh", fixed).length, 0);
});

test("the rule reads the whole command, not just the first line", () => {
  // 拆成两行写的时候 --noproxy 在下半行，漏看它就会把一个正确的调用报成问题。
  const wrapped = 'curl -s -m 30 \\\n  --noproxy \'*\' "$URL"';
  assert.equal(offenders("demo.sh", wrapped).length, 0);
});

test("printed text and remote commands are not calls on this machine", () => {
  // heredoc 里的示例、注释、echo 出来的用法、以及 ssh 引号里的命令，都不算。
  const text = [
    "cat <<'EOF'",
    '用 curl -s -b "${COOKIE}=${SID}" ${BASE}/api/web/me 试一下',
    "EOF",
    "# curl -sf http://127.0.0.1:8080/api/health",
    'echo "(dry-run) curl $HOST/api/health"',
    'if ssh host "curl -sf http://127.0.0.1:5181/api/health"; then',
  ].join("\n");
  assert.deepEqual(offenders("demo.sh", text), []);
});
