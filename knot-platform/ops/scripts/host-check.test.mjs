// 主机门禁的三条硬约束，用结构断言 + 一次真跑守住。
//
// 这次踩到的是：新机器上没有 node（非登录 PATH 里没有 /opt/homebrew/bin），
// 也没有 PostgreSQL，而部署脚本一路装到探活才失败、还顺手回滚了一次。
// 门禁要满足的是：
//   1. 在任何写操作之前停下，且给出能照做的命令（不是「缺少依赖」四个字）；
//   2. 非 macOS 直接拒绝——main 只支持 macOS + launchd，别的平台是 fork 的事；
//   3. 不读 stdin：部署脚本经 `ssh … bash -s <<'REMOTE'` 执行，stdin 就是脚本本身，
//      一次 read 会把剩下的行吃掉，表现成「脚本跑到一半就没了」。

import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../..");

function read(rel) {
  return readFileSync(path.join(APP, rel), "utf8");
}

const DEPLOY = read("ops/scripts/deploy-site.sh");
const HOST_CHECK = read("ops/scripts/lib/host-check.sh");
const RUN_SERVER = read("ops/scripts/run-knot-platform.sh");

test("门禁在任何写操作之前：主机 → 配置 → 数据库 → 停服务", () => {
  const host = DEPLOY.indexOf('knot_gate "主机"');
  const config = DEPLOY.indexOf('check sites/$KNOT_SITE/site.env');
  const db = DEPLOY.indexOf('knot_gate "数据库"');
  const stop = DEPLOY.indexOf("# ---- 4. 停服务");
  assert.ok(host > 0, "deploy-site.sh 里没有主机门禁");
  assert.ok(db > 0, "deploy-site.sh 里没有数据库门禁");
  assert.ok(host < config, "主机门禁必须在读站点配置之前（配置校验本身要用 node）");
  assert.ok(config < db, "数据库门禁要在站点配置之后、停服务之前");
  assert.ok(db < stop, "数据库门禁必须在停服务之前，否则失败时已经停机了");
});

test("门禁不读 stdin：经 ssh 管道执行时一次 read 会吃掉脚本剩下的行", () => {
  // 只允许 `while IFS= read -r …` 这种从管道读行的写法。
  const offenders = DEPLOY.split("\n")
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^\s*(read|read\s+-[a-z]*)\b(?!.*\|)/.test(line) && !/<<</.test(line))
    .filter(({ line }) => !/IFS=\s*read/.test(line));
  assert.deepEqual(
    offenders.map(({ index }) => index + 1),
    [],
    `deploy-site.sh 里有会从 stdin 取输入的语句：${offenders.map((o) => o.line.trim()).join(" / ")}`,
  );
});

test("Node 用绝对路径，不让 launchd 去猜 PATH", () => {
  // 启动脚本必须认 platform.env 里的 KNOT_NODE_BIN；写死 node 的服务在
  // 非登录环境里就是 command not found。
  assert.match(RUN_SERVER, /exec "\$\{KNOT_NODE_BIN:-node\}" src\/index\.js/);
  // 部署脚本把解析结果交给 config.mjs 落盘，否则运行时拿不到这个键。
  assert.match(DEPLOY, /export [^\n]*KNOT_NODE_BIN/);
  assert.match(HOST_CHECK, /export KNOT_NODE_BIN="\$best"/);
  // 主版本门槛：22 是 sharp / 内置 fetch 都还在的语言特性线上的最低值。
  assert.match(HOST_CHECK, /best_major >= 22/);
});

test("非 macOS 在门禁处被拒绝，并给出 fork 的接缝", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "knot-uname-"));
  const stub = path.join(dir, "uname");
  writeFileSync(stub, "#!/bin/sh\necho Linux\n");
  chmodSync(stub, 0o755);

  const script = [
    `source "${APP}/ops/scripts/lib/host-check.sh"`,
    "knot_pf_begin",
    'knot_check_host_platform || echo "REJECTED"',
    'knot_pf_finish "主机" || echo "BLOCKED"',
  ].join("\n");

  let output = "";
  try {
    output = execFileSync("bash", ["-c", script], {
      encoding: "utf8",
      // 只换掉 uname：sw_vers 之类的真命令仍要能找到。
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
    });
  } catch (error) {
    output = String(error.stdout || "");
  }
  assert.match(output, /REJECTED/);
  assert.match(output, /BLOCKED/);
  assert.match(output, /FAIL\s+平台/);
  assert.match(output, /fork/);
});

test("bootstrap 默认只打印计划，且不碰服务、数据目录与端口", () => {
  const raw = read("ops/scripts/bootstrap-host.sh");
  // 注释里会写「不 brew services start」，那是说明不是命令：只看会被执行的代码。
  const code = raw
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
  // 默认 DO_IT=0：没有 --yes 就什么都不装。
  assert.match(code, /DO_IT=0/);
  assert.match(code, /--yes\)\s*\n\s*DO_IT=1/);
  // 只装 keg-only 的 brew 包；起库、建库、设端口归部署脚本。
  assert.match(code, /install node@22/);
  assert.match(code, /install postgresql@16/);
  assert.doesNotMatch(code, /brew services/);
  assert.doesNotMatch(code, /^\s*(?:\S*\/)?initdb\b/m);
  assert.doesNotMatch(code, /^\s*(?:\S*\/)?createdb\b/m);
  // 不读 stdin：它可以被 deploy-site.sh 在目标机上就地调用。
  assert.doesNotMatch(code, /^\s*read\s/m);
});
