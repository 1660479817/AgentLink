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
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

// 库这一步有两个只在真机上才暴露的坑，都放在门禁里先拦：
//   * 端口被别的程序占着（bot00 上 8080 被无关 node 占着），pg_isready 只说 no response，
//     再往下 pg_ctl 才报 could not bind，报错点离原因很远；
//   * psql -h 传路径时指的是 socket 目录，不是数据目录（见 ensure-knot-postgres.sh）。
function pgBinDir() {
  for (const dir of [
    process.env.KNOT_PG_BIN,
    "/opt/homebrew/opt/postgresql@16/bin",
    "/opt/homebrew/opt/postgresql@15/bin",
    "/opt/homebrew/opt/postgresql@14/bin",
    "/usr/local/opt/postgresql@16/bin",
    "/usr/local/opt/postgresql@14/bin",
  ]) {
    if (dir && existsSync(path.join(dir, "initdb"))) return dir;
  }
  return "";
}

test("端口被别的程序占着时门禁直接拦下，并指向 KNOT_PGPORT", async () => {
  const bin = pgBinDir();
  if (!bin) return; // 没有 PostgreSQL 的机器上跳过，不让 npm test 变红。

  const net = await import("node:net");
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  const script = [
    `source "${APP}/ops/scripts/lib/host-check.sh"`,
    "knot_pf_begin",
    'knot_check_pg_local || echo "BLOCKED"',
    'knot_pf_finish "数据库" || echo "GATE-FAIL"',
  ].join("\n");

  let output = "";
  try {
    output = execFileSync("bash", ["-c", script], {
      encoding: "utf8",
      env: { ...process.env, KNOT_PG_BIN: bin, KNOT_PGPORT: String(port), KNOT_PG_SOCKET_DIR: "/tmp" },
    });
  } catch (error) {
    output = String(error.stdout || "");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  assert.match(output, /BLOCKED/);
  assert.match(output, /GATE-FAIL/);
  assert.match(output, new RegExp(`端口 ${port} 已被`));
  // 该改的是数据库端口，不是站点端口：这句写错会让人去改 KNOT_PORT。
  assert.match(output, /KNOT_PGPORT/);
});

test("socket 目录与数据目录是两个概念：门禁按 socket 目录判断", () => {
  // 库已经在跑却找不到 socket 时只该 warn（部署会按实际目录连），不该 fail。
  assert.match(HOST_CHECK, /-S "\$sock\/\.s\.PGSQL\.\$port"/);
  assert.match(HOST_CHECK, /KNOT_PG_SOCKET_DIR:-\/tmp/);
  assert.doesNotMatch(HOST_CHECK, /pg_isready[^\n]*-h "\$KNOT_PGDATA"/);
});

test("站点端口：别的程序占着时 warn（不是 fail），本站点自己的 Backend 算 ok", async () => {
  const net = await import("node:net");
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  const run = (extra) =>
    execFileSync(
      "bash",
      [
        "-c",
        [
          `source "${APP}/ops/scripts/lib/host-check.sh"`,
          "knot_pf_begin",
          `KNOT_PORT=${port} knot_check_site_port`,
          "knot_pf_finish 端口 || echo GATE-FAIL",
        ].join("\n"),
      ],
      { encoding: "utf8", env: { ...process.env, ...extra } }
    );
  try {
    // 占用者是 node（测试进程本身），不是这个站点 releases/ 下的 Backend：只提示。
    const output = run({ KNOT_DEPLOY_ROOT: os.tmpdir() });
    assert.match(output, /warn\s+端口/);
    assert.match(output, new RegExp(`127\\.0\\.0\\.1:${port}`));
    // warn 不拦部署：闸门不该因为端口提示就退出。
    assert.doesNotMatch(output, /GATE-FAIL/);
    // 提示里要给的是站点端口这个键，不是数据库端口。
    assert.match(output, /KNOT_PORT/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("端口门禁插在数据库之后、停服务之前", () => {
  const db = DEPLOY.indexOf('knot_gate "数据库"');
  const port = DEPLOY.indexOf('knot_gate "端口"');
  const stop = DEPLOY.indexOf("# ---- 4. 停服务");
  assert.ok(port > db, "端口门禁要在数据库门禁之后");
  assert.ok(port < stop, "端口门禁必须在停服务之前");
});
