// 卸载执行器：只摘单元，数据一个字节都不许动。
//
// 这个脚本能造成的最大伤害，全在「删」这一个动作上。所以测试盯的不是它删了什么，
// 而是它没删什么：站点配置、发布包、上传目录、数据目录、别的实例的单元。
//
// 真跑 bash、真读 site-config.sh，HOME 指到临时目录、PATH 最前面放一个只记调用
// 的 launchctl；这台机器上真的 LaunchAgents 一次都不碰。

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("./uninstall-site.sh", import.meta.url));

function tmp(prefix) {
  return realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)));
}

// 一个假的部署根：有站点配置、发布包、上传文件和部署根上的哨兵文件。
// 哨兵是关键——脚本里任何一次「顺手清理部署根」都会让它消失。
function makeDeployRoot(instance) {
  const root = tmp("knot-uninstall-root-");
  const site = path.join(root, "sites", "test");
  mkdirSync(site, { recursive: true });
  writeFileSync(
    path.join(site, "site.env"),
    `KNOT_INSTANCE="${instance}"\nKNOT_PUBLIC_ORIGIN="http://127.0.0.1:8099"\nKNOT_PORT=8099\nKNOT_PGDATA="${root}/pgdata"\n`,
    { mode: 0o600 },
  );
  writeFileSync(path.join(site, "platform.env"), `UPLOAD_DIR="${root}/var/uploads"\n`, { mode: 0o600 });

  mkdirSync(path.join(root, "releases", "knot-0.9.0-abc1234"), { recursive: true });
  writeFileSync(path.join(root, "releases", "knot-0.9.0-abc1234", "payload.txt"), "release\n");
  mkdirSync(path.join(root, "var", "uploads"), { recursive: true });
  writeFileSync(path.join(root, "var", "uploads", "a.png"), "png\n");
  mkdirSync(path.join(root, "artifacts"), { recursive: true });
  writeFileSync(path.join(root, "artifacts", "knot-0.9.0.tar.gz"), "tgz\n");
  mkdirSync(path.join(root, "pgdata"), { recursive: true });
  writeFileSync(path.join(root, "pgdata", "PG_VERSION"), "16\n");
  // 部署根本身也有东西：不是数据、也不是单元，但一样不许动。
  writeFileSync(path.join(root, "deployed.json"), "{}\n");
  return { root, site };
}

// 假 HOME：LaunchAgents 目录在它下面，PATH 最前面是一个只记调用、什么都不做的
// launchctl。bootout 是异步的，真 launchctl 会等待；假的不需要。
function makeHome() {
  const home = tmp("knot-uninstall-home-");
  const bin = path.join(home, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, "launchctl"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const agents = path.join(home, "Library", "LaunchAgents");
  mkdirSync(agents, { recursive: true });
  return { home, bin, agents };
}

function writePlist(agents, name, program) {
  const file = path.join(agents, `${name}.plist`);
  writeFileSync(
    file,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${name}</string>
  <key>EnvironmentVariables</key><dict>
    <key>KNOT_DEPLOY_ROOT</key><string>${program.replace(/\/current\/.*$/, "")}</string>
  </dict>
  <key>ProgramArguments</key><array><string>${program}</string></array>
</dict></plist>
`,
  );
  return file;
}

function run({ root, site, home }, args) {
  return spawnSync("bash", [SCRIPT, ...args], {
    env: {
      ...process.env,
      HOME: home.home,
      PATH: `${home.bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
      KNOT_SITE_FILE: path.join(site, "site.env"),
      KNOT_DEPLOY_ROOT: root,
      KNOT_SITE: "",
      KNOT_INSTANCE: "",
    },
    encoding: "utf8",
  });
}

// 数据区的快照：路径 → 内容。用来断言「一个文件都没变、也没少」。
function snapshot(root) {
  const out = {};
  for (const rel of ["sites", "releases", "var/uploads", "artifacts", "pgdata", "deployed.json"]) {
    const full = path.join(root, rel);
    if (!existsSync(full)) continue;
    if (!statSync(full).isDirectory()) {
      out[rel] = readFileSync(full, "utf8");
      continue;
    }
    const walk = (dir) => {
      for (const entry of readdirSafe(dir)) {
        const next = path.join(dir, entry);
        if (statSync(next).isDirectory()) walk(next);
        else out[path.relative(root, next)] = readFileSync(next, "utf8");
      }
    };
    walk(full);
  }
  return out;
}

function readdirSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function installUnits(agents, root, instance) {
  const base = `${root}/current/ops/scripts`;
  return {
    platform: writePlist(agents, `com.knot.${instance}.platform`, `${base}/run-knot-platform.sh`),
    postgres: writePlist(agents, `com.knot.${instance}.postgres`, `${base}/ensure-knot-postgres.sh`),
    gc: writePlist(agents, `com.knot.${instance}.gc`, `${base}/gc-knot-storage.sh`),
    tunnel: writePlist(agents, `com.knot.${instance}.entry-tunnel`, `${base}/run-entry-tunnel.sh`),
    probe: writePlist(agents, `com.knot.${instance}.openclaw-probe`, `${base}/openclaw-check.sh`),
  };
}

test("dry-run: 列出要摘的单元，不删文件、不停服务", () => {
  const { root, site } = makeDeployRoot("wang");
  const home = makeHome();
  const units = installUnits(home.agents, root, "wang");
  const before = snapshot(root);

  const result = run({ root, site, home }, ["--site", "test", "--dry-run"]);
  assert.equal(result.status, 0, result.stderr);
  for (const file of Object.values(units)) assert.equal(existsSync(file), true);
  assert.deepEqual(snapshot(root), before);
  assert.match(result.stdout, /com\.knot\.wang\.platform/);
  assert.match(result.stdout, /dry-run/);
});

test("没给 --yes: 拒绝执行，什么都没动", () => {
  const { root, site } = makeDeployRoot("wang");
  const home = makeHome();
  const units = installUnits(home.agents, root, "wang");
  const before = snapshot(root);

  const result = run({ root, site, home }, ["--site", "test"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--yes/);
  for (const file of Object.values(units)) assert.equal(existsSync(file), true);
  assert.deepEqual(snapshot(root), before);
});

test("--yes: 摘掉本实例的单元，数据与部署根里的东西一个不动", () => {
  const { root, site } = makeDeployRoot("wang");
  const home = makeHome();
  const units = installUnits(home.agents, root, "wang");
  const before = snapshot(root);

  const result = run({ root, site, home }, ["--site", "test", "--yes"]);
  assert.equal(result.status, 0, result.stderr);
  for (const file of Object.values(units)) assert.equal(existsSync(file), false);
  assert.deepEqual(snapshot(root), before, "卸载不该改动站点配置、发布包、上传目录或数据目录");
});

test("--yes: 同一台机器上别的实例的单元不碰", () => {
  const { root, site } = makeDeployRoot("wang");
  const home = makeHome();
  installUnits(home.agents, root, "wang");
  const other = writePlist(
    home.agents,
    "com.knot.cpswang.platform",
    "/Users/me/knot/cpswang/current/ops/scripts/run-knot-platform.sh",
  );

  const result = run({ root, site, home }, ["--site", "test", "--yes"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(other), true);
});

test("--yes: 改名前的旧标签引用本部署根时一并摘掉", () => {
  const { root, site } = makeDeployRoot("wang");
  const home = makeHome();
  const legacy = writePlist(home.agents, "com.knot.platform", `${root}/current/ops/scripts/run-knot-platform.sh`);

  const result = run({ root, site, home }, ["--site", "test", "--yes"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(legacy), false);
});

test("--yes: 标签属于本实例但内容指向别处时不删，只报出来", () => {
  const { root, site } = makeDeployRoot("wang");
  const home = makeHome();
  const hijacked = writePlist(
    home.agents,
    "com.knot.wang.platform",
    "/Users/me/knot/elsewhere/current/ops/scripts/run-knot-platform.sh",
  );
  const before = snapshot(root);

  const result = run({ root, site, home }, ["--site", "test", "--yes"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(hijacked), true, "删掉它等于替另一个部署根卸载");
  assert.match(result.stdout, /警告/);
  assert.deepEqual(snapshot(root), before);
});

test("没有单元可摘时也正常结束，并仍然自证数据未动", () => {
  const { root, site } = makeDeployRoot("wang");
  const home = makeHome();
  const before = snapshot(root);

  const result = run({ root, site, home }, ["--site", "test", "--yes"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /没有找到归本部署根管的常驻单元/);
  assert.deepEqual(snapshot(root), before);
});

test("HOME 不是绝对路径时直接退出，不去猜一个目录删", () => {
  const { root, site } = makeDeployRoot("wang");
  const home = makeHome();
  installUnits(home.agents, root, "wang");

  const result = spawnSync("bash", [SCRIPT, "--site", "test", "--yes"], {
    env: {
      ...process.env,
      HOME: "",
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      KNOT_SITE_FILE: path.join(site, "site.env"),
      KNOT_DEPLOY_ROOT: root,
    },
    encoding: "utf8",
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /HOME/);
});

test("--runtime none 的后台进程被停掉，pid 记录一并清掉", () => {
  const { root, site } = makeDeployRoot("wang");
  const home = makeHome();
  mkdirSync(path.join(root, "var", "run"), { recursive: true });
  // 起一个真的睡不着的小进程，脚本要能把它停掉。
  // 用 spawn + detached + stdio ignore：spawnSync 会等 stdout 关闭，
  // 而子进程继承来的 stdout 要等它自己睡完才关，测试会跟着卡 30 秒。
  const child = spawn("sleep", ["30"], { stdio: "ignore", detached: true });
  child.unref();
  const pid = child.pid;
  assert.ok(pid > 0);
  writeFileSync(path.join(root, "var", "run", "backend.pid"), `${pid}\n`);
  const before = snapshot(root);

  try {
    const result = run({ root, site, home }, ["--site", "test", "--yes"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(path.join(root, "var", "run", "backend.pid")), false);
    assert.deepEqual(snapshot(root), before, "pid 文件不是数据区，数据区仍须原样");
    // 进程可能已经退出但还没被回收（僵尸），那种状态也算停掉了。
    const stat = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" }).stdout.trim();
    assert.ok(stat === "" || stat.startsWith("Z"), `进程还在跑：${stat}`);
  } finally {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // 已经被脚本停掉了，正常。
    }
  }
});

test("单元都摘完之后不再有归本部署根的 plist 残留", () => {
  const { root, site } = makeDeployRoot("wang");
  const home = makeHome();
  installUnits(home.agents, root, "wang");
  writePlist(home.agents, "com.knot.platform", `${root}/current/ops/scripts/run-knot-platform.sh`);

  assert.equal(run({ root, site, home }, ["--site", "test", "--yes"]).status, 0);

  const left = readdirSafe(home.agents).filter((name) => name.startsWith("com.knot."));
  assert.deepEqual(left, []);
});
