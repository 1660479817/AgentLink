import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

// 单元文件是模板，占位符漏填会原样写进 launchd 读的 plist：launchd 不会因为
// ProgramArguments 里是 __KNOT_CURRENT__/ops/... 就报错，它只是拉不起进程，
// 表现成「部署成功、服务起不来」，日志目录里什么也没有。
// 这里把「模板里出现的占位符」和「site-config.sh 会替换的占位符」对一遍。
//
// main 只支持 macOS：模板只有 launchd/ 一份。systemd 是 fork 的事，不在这里。

const UNIT_DIR = fileURLToPath(new URL("../launchd/", import.meta.url));
const SITE_CONFIG = readFileSync(
  fileURLToPath(new URL("./lib/site-config.sh", import.meta.url)),
  "utf8",
);

const PLACEHOLDER = /__KNOT_[A-Z_]+__/g;

function unitFiles() {
  return readdirSync(UNIT_DIR)
    .filter((name) => name.endsWith(".plist"))
    .map((name) => ({ name, path: `${UNIT_DIR}${name}` }));
}

function substituted() {
  const names = new Set();
  for (const match of SITE_CONFIG.matchAll(/s\|(__KNOT_[A-Z_]+__)\|/g)) names.add(match[1]);
  return names;
}

test("LaunchAgent 模板里的占位符都有对应的替换", () => {
  const known = substituted();
  assert.ok(known.size >= 3, `site-config.sh 里只找到 ${known.size} 个占位符替换`);
  const missing = [];
  for (const file of unitFiles()) {
    const text = readFileSync(file.path, "utf8");
    for (const name of text.match(PLACEHOLDER) ?? []) {
      if (!known.has(name)) missing.push(`${file.name}: ${name}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("每个模板的 Label 都是占位符，没有写死的标签", () => {
  // 写死标签的话，同一台机器上的第二个实例会把它换成自己的路径：
  // 前一个实例的站点看着正常，直到重启机器才发现它没在跑。
  const offenders = [];
  for (const file of unitFiles()) {
    const text = readFileSync(file.path, "utf8");
    if (!/<key>Label<\/key>\s*<string>__KNOT_LABEL__<\/string>/.test(text)) {
      offenders.push(file.name);
    }
  }
  assert.deepEqual(offenders, []);
});

test("主进程的 LaunchAgent 从 current 启动，日志写在部署根下", () => {
  const text = readFileSync(`${UNIT_DIR}platform.plist`, "utf8");
  // current 是软链：回滚只切链接，plist 不用重写。
  assert.match(text, /<string>__KNOT_CURRENT__\/ops\/scripts\/run-knot-platform\.sh<\/string>/);
  // 服务跑起来不靠登录 shell 的 PATH：node 的绝对路径由 platform.env 的
  // KNOT_NODE_BIN 给出，plist 只需要指到脚本。
  assert.match(text, /<key>StandardErrorPath<\/key>\s*<string>__KNOT_HOME__\/var\/log\/knot-platform\.err\.log<\/string>/);
  assert.match(text, /<key>KeepAlive<\/key>\s*<true\/>/);
});

test("备份每天 04:15 跑一次，且不在加载时立刻跑", () => {
  const text = readFileSync(`${UNIT_DIR}backup.plist`, "utf8");
  // RunAtLoad=true 会在每次部署（kickstart/bootstrap）时插一次备份，把「每天一次」
  // 变成「每次部署一次」，备份目录很快被同一天的几份挤满。
  assert.match(text, /<key>RunAtLoad<\/key>\s*<false\/>/);
  assert.match(text, /<key>StartCalendarInterval<\/key>/);
  assert.match(text, /__KNOT_CURRENT__\/ops\/scripts\/backup-knot\.sh/);
});
