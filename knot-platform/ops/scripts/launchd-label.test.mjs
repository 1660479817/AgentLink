// 常驻单元标签：同一台机器上跑两个实例时，标签不能撞。
//
// launchd 的标签在用户命名空间里唯一，不按目录分。标签撞了，部署 B 会把 A 的单元
// bootout 掉、换成自己的路径——A 的站点仍然返回 200（只是没人再重启它），
// 直到机器重启才发现它根本没在跑。这里用真的 bash 跑 site-config.sh，
// 因为标签是在 shell 里算的，用 JS 复刻一遍测不出两边是否一致。
//
// 整个文件不碰这台机器上真的 LaunchAgents：HOME 指到临时目录，
// PATH 最前面放一个只记调用、什么都不做的 launchctl。

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const LIB = fileURLToPath(new URL("./lib/site-config.sh", import.meta.url));

function tmp(prefix) {
  return realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function makeSite({ instance } = {}) {
  const dir = tmp("knot-site-");
  const extra = instance === undefined ? "" : `KNOT_INSTANCE="${instance}"\n`;
  writeFileSync(
    path.join(dir, "site.env"),
    `${extra}KNOT_PUBLIC_ORIGIN="http://127.0.0.1:8099"\nKNOT_PORT=8099\n`,
    { mode: 0o600 },
  );
  return dir;
}

// 假 HOME + 假 launchctl：测试只验证 plist 的增删，不去 bootout 真的单元。
function makeHome() {
  const home = tmp("knot-home-");
  const bin = path.join(home, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, "launchctl"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  return { home, bin };
}

function shellEnv({ site, root, home }) {
  return {
    ...process.env,
    HOME: home.home,
    PATH: `${home.bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
    KNOT_SITE_FILE: path.join(site, "site.env"),
    KNOT_DEPLOY_ROOT: root,
  };
}

function run({ site, root, home, script, args = [] }) {
  return spawnSync("bash", ["-c", `source "$1"; ${script}`, "_", LIB, ...args], {
    env: shellEnv({ site, root, home }),
    encoding: "utf8",
  });
}

function label(role = "platform", options) {
  const { site, root, home } = options;
  return execFileSync("bash", ["-c", 'source "$1"; knot_label "$2"', "_", LIB, role], {
    env: shellEnv({ site, root, home }),
    encoding: "utf8",
  }).trim();
}

test("label: 缺省取部署根目录名，两个部署根得到两个标签", () => {
  const site = makeSite();
  const home = makeHome();
  assert.equal(label("platform", { site, root: "/Users/me/knot/wang", home }), "com.knot.wang.platform");
  assert.notEqual(
    label("platform", { site, root: "/Users/me/knot/wang", home }),
    label("platform", { site, root: "/Users/me/knot/cpswang", home }),
  );
});

test("label: 角色决定后缀，同一实例的单元互不覆盖", () => {
  const site = makeSite();
  const home = makeHome();
  const roles = ["platform", "postgres", "backup", "gc", "entry-tunnel", "openclaw-probe"];
  const labels = roles.map((role) => label(role, { site, root: "/Users/me/knot/wang", home }));
  assert.deepEqual(labels, roles.map((role) => `com.knot.wang.${role}`));
});

test("label: KNOT_INSTANCE 覆盖目录名，部署根改名不影响已装的单元", () => {
  const site = makeSite({ instance: "wang" });
  const home = makeHome();
  assert.equal(label("platform", { site, root: "/Users/me/elsewhere", home }), "com.knot.wang.platform");
});

test("label: 不能构成标签的实例名被拒绝，而不是装出一个坏标签", () => {
  const site = makeSite({ instance: "wang/site" });
  const home = makeHome();
  const result = run({ site, root: "/Users/me/knot/wang", home, script: "knot_label platform" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /实例名/);
  assert.equal(result.stdout.trim(), "");
});

function writePlist(home, name, program) {
  mkdirSync(path.join(home.home, "Library", "LaunchAgents"), { recursive: true });
  const file = path.join(home.home, "Library", "LaunchAgents", `${name}.plist`);
  writeFileSync(
    file,
    `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>Label</key><string>${name}</string>
  <key>ProgramArguments</key><array><string>${program}</string></array>
</dict></plist>
`,
  );
  return file;
}

test("prune: 只收掉引用本部署根的旧单元，别的实例与别的 job 不动", () => {
  const site = makeSite();
  const home = makeHome();
  writePlist(home, "com.knot.platform", "/Users/me/knot/wang/current/ops/scripts/run-knot-platform.sh");
  writePlist(home, "com.knot.edge-tunnel", "/Users/me/knot/wang/current/ops/scripts/run-entry-tunnel.sh");
  writePlist(home, "com.knot.cpswang.platform", "/Users/me/knot/cpswang/current/ops/scripts/run-knot-platform.sh");
  writePlist(home, "com.other.agent", "/usr/local/bin/agent");

  const result = run({
    site,
    root: "/Users/me/knot/wang",
    home,
    script: "knot_prune_launchd com.knot.wang.platform com.knot.wang.gc",
  });
  assert.equal(result.status, 0, result.stderr);

  const has = (name) => existsSync(path.join(home.home, "Library", "LaunchAgents", `${name}.plist`));
  assert.equal(has("com.knot.platform"), false);
  assert.equal(has("com.knot.edge-tunnel"), false);
  assert.equal(has("com.knot.cpswang.platform"), true);
  assert.equal(has("com.other.agent"), true);
  // 收掉的名字要说出来，不然「换了标签」这件事在部署日志里查不到。
  assert.match(result.stdout, /com\.knot\.platform/);
});

test("prune: 保留名单里的标签不动", () => {
  const site = makeSite();
  const home = makeHome();
  const keep = writePlist(
    home,
    "com.knot.wang.platform",
    "/Users/me/knot/wang/current/ops/scripts/run-knot-platform.sh",
  );

  const result = run({
    site,
    root: "/Users/me/knot/wang",
    home,
    script: "knot_prune_launchd com.knot.wang.platform",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(keep), true);
  assert.ok(readFileSync(keep, "utf8").includes("com.knot.wang.platform"));
});

test("install: 装出来的 plist 标签带实例名，占位符不留残迹", () => {
  const site = makeSite();
  const home = makeHome();
  const template = fileURLToPath(new URL("../launchd/platform.plist", import.meta.url));
  const result = run({
    site,
    root: "/Users/me/knot/wang",
    home,
    script: 'knot_install_launchd "$2" "$(knot_label platform)"',
    args: [template],
  });
  assert.equal(result.status, 0, result.stderr);
  const installed = path.join(home.home, "Library", "LaunchAgents", "com.knot.wang.platform.plist");
  assert.equal(existsSync(installed), true);
  const text = readFileSync(installed, "utf8");
  assert.match(text, /<key>Label<\/key>\s*<string>com\.knot\.wang\.platform<\/string>/);
  assert.doesNotMatch(text, /__KNOT_/);
});
