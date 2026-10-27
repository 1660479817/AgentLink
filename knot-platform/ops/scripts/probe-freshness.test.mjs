// 部署不该把「刚刚读到的事实」抹掉。
//
// 探针每五分钟写一次 var/run/openclaw-status.json，控制台上那一块就读它。
// 部署过程里有两处会碰这份文件，顺序还正好相反：
//
//   1. 装单元时 kickstart 一次探针 —— 写出新读数；
//   2. 之后的 ensure-openclaw.sh 同步智能体 —— 以前在这里无条件删掉它。
//
// 结果是每次部署完，页面都要空等下一个五分钟，看上去像探测坏了。这里守住两条：
// 只有「明确关闭」（off）才清，以及同步之后立刻补一次探测。都是脚本结构断言——
// 它们跑在部署机上，单元测试里没有 launchd，也没有真的 OpenClaw。

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function lines(rel) {
  return readFileSync(path.join(HERE, rel), "utf8").split("\n");
}

test("同步智能体时只清掉 off，不删一份正常的读数", () => {
  const text = lines("ensure-openclaw.sh");
  const removals = text
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /\brm\b.*(?:\$STATUS_FILE|openclaw-status\.json)/.test(line));
  assert.ok(removals.length >= 1, "ensure-openclaw.sh 里没找到清状态文件的那一行");
  for (const { index } of removals) {
    // 往前几行里必须有一次针对 off 的 grep 判断，而不是无条件 rm。
    const guarded = text
      .slice(Math.max(0, index - 5), index)
      .some((line) => /grep\s+-q.*"off"/.test(line));
    assert.ok(guarded, `第 ${index + 1} 行无条件删了状态文件：${text[index].trim()}`);
  }
});

test("openclaw 同步之后立刻补一次探测，不等定时器", () => {
  const text = lines("deploy-site.sh");
  assert.ok(
    text.some((line) => /^openclaw_probe_now\(\)/.test(line)),
    "deploy-site.sh 里没有 openclaw_probe_now",
  );
  assert.ok(
    text.some((line) => /launchctl kickstart[^\n]*com\.knot\.openclaw-probe/.test(line)),
    "openclaw_probe_now 没有在 launchd 上拉起探针",
  );

  // 每个装了 openclaw 的分支都要补这一下；漏一个就等于那台机器回到空等五分钟。
  const ensure = text.filter((line) => /OPENCLAW_ENABLE_PROCESS=1 .*ensure-openclaw\.sh/.test(line)).length;
  const probe = text.filter((line) => /^\s*openclaw_probe_now\s*$/.test(line)).length;
  assert.ok(ensure >= 1, "deploy-site.sh 里没找到调用 ensure-openclaw.sh 的地方");
  assert.equal(probe, ensure, `调用同步 ${ensure} 次，补探测 ${probe} 次`);
});
