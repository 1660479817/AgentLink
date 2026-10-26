// 常驻进程的文件描述符软限。
//
// 入口的隧道进程每转发一条连接都要开一个 socket，被 launchd 的 256 软限卡住时
// 日志里是 "socket: Too many open files"，入口把每条被 reset 的连接记成 502，
// 而 Backend 自己一直健康。
//
// 用真的 bash 跑 fd-limit.sh：抬限靠的是 shell 内建 ulimit，
// 在 JS 里复刻一遍测不出它到底有没有生效。

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const LIB = fileURLToPath(new URL("./lib/fd-limit.sh", import.meta.url));

// 每个用例一个独立 bash：软限是从父进程继承的，改坏了一次就回不去。
function run(script) {
  return execFileSync("bash", ["-c", `source "$1"; ${script}`, "_", LIB], { encoding: "utf8" }).trim();
}

test("fd limit: raises a launchd-like soft limit to the target, leaving the hard limit alone", () => {
  // launchd 的常态：软限 256，硬限 unlimited。
  const out = run('ulimit -Sn 256; knot_raise_fd_limit; echo "$(ulimit -n) $(ulimit -Hn)"');
  const [soft, hard] = out.split(" ");
  assert.ok(Number(soft) >= 1024, `软限仍是 ${soft}`);
  assert.equal(hard, "unlimited");
});

test("fd limit: a target at or below the current limit leaves it alone", () => {
  const out = run('ulimit -Sn 2048; knot_raise_fd_limit 1024; ulimit -n');
  assert.equal(Number(out), 2048);
});

test("fd limit: clamping to a finite hard limit still returns success", () => {
  // 目标比硬限还大时退到硬限，且不能让 set -e 的调用方退出。
  const out = run(
    'ulimit -Sn 512; ulimit -Hn 512; set -e; knot_raise_fd_limit 99999999; echo "rc=$? limit=$(ulimit -n)"'
  );
  assert.equal(/rc=(\d+)/.exec(out)?.[1], "0");
  assert.match(out, /limit=512/);
});
