import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "backup-knot.sh");
const HAS_RSYNC = spawnSync("rsync", ["--version"], { stdio: "ignore" }).status === 0;

function write(file, content, mode) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
  if (mode) chmodSync(file, mode);
}

// 一套能跑通的最小布局：部署根里一个站点，HOME 里一个 OpenClaw 状态目录。
function scaffold(options = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "knot-backup-"));
  const deploy = path.join(root, "deploy");
  const home = path.join(root, "home");
  const backups = path.join(root, "backups");

  write(
    path.join(deploy, "sites", "demo", "site.env"),
    [
      "KNOT_ADMIN_EMAIL=admin@example.com",
      `KNOT_BACKUP_DIR=${backups}`,
      ...(options.siteEnv ?? []),
      "",
    ].join("\n"),
    0o600,
  );
  write(path.join(deploy, "sites", "demo", "platform.env"), "SMTP_PASS=hunter2\n", 0o600);
  write(path.join(deploy, "sites", "demo", "agents", "knot-intel.env"), "API_KEY=abc\n", 0o600);

  write(path.join(home, ".openclaw", "openclaw.json"), "{}\n");
  write(path.join(home, ".openclaw", "credentials", "relay.secret"), "s3cret\n", 0o600);
  write(path.join(home, ".openclaw", "agents", "knot-admin", "agent", "memory.sqlite"), "db\n");
  write(path.join(home, ".openclaw", "agents", "knot-admin", "agent", "memory.sqlite-wal"), "wal\n");
  write(path.join(home, ".openclaw", "agents", "knot-admin", "agent", "memory.sqlite-shm"), "shm\n");
  write(path.join(home, ".openclaw", "agents", "knot-admin", "agent", "x-lock.sqlite"), "lock\n");
  // 这些都能重建，不该进快照。
  write(path.join(home, ".openclaw", "cache", "blob.bin"), "x".repeat(1024));
  write(path.join(home, ".openclaw", "browser", "blob.bin"), "x".repeat(1024));
  write(path.join(home, ".openclaw", "npm", "pkg.tgz"), "x".repeat(1024));

  return { root, deploy, home, backups };
}

function run(ctx, extraEnv = {}) {
  return execFileSync("bash", [SCRIPT, "--config-only"], {
    env: {
      PATH: process.env.PATH,
      HOME: ctx.home,
      KNOT_DEPLOY_ROOT: ctx.deploy,
      KNOT_SITE: "demo",
      ...extraEnv,
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function snapshotDirs(backups) {
  return readdirSync(backups)
    .filter((name) => name.startsWith("knot-"))
    .sort();
}

test("config-only 快照收站点配置和 OpenClaw 状态", { skip: !HAS_RSYNC }, () => {
  const ctx = scaffold();
  run(ctx);

  const [stamp] = snapshotDirs(ctx.backups);
  assert.ok(stamp, "没有生成快照");
  const dest = path.join(ctx.backups, stamp);

  assert.equal(readFileSync(path.join(dest, "sites", "demo", "platform.env"), "utf8"), "SMTP_PASS=hunter2\n");
  assert.ok(existsSync(path.join(dest, "sites", "demo", "agents", "knot-intel.env")));
  assert.ok(existsSync(path.join(dest, "openclaw", "openclaw.json")));
  assert.ok(existsSync(path.join(dest, "openclaw", "credentials", "relay.secret")));
  assert.ok(existsSync(path.join(dest, "openclaw", "agents", "knot-admin", "agent", "memory.sqlite")));

  assert.ok(existsSync(path.join(dest, "openclaw", "agents", "knot-admin", "agent", "memory.sqlite-wal")));

  // 可重建的目录和运行中的 sqlite 临时文件都不收。
  assert.equal(existsSync(path.join(dest, "openclaw", "cache")), false);
  assert.equal(existsSync(path.join(dest, "openclaw", "browser")), false);
  assert.equal(existsSync(path.join(dest, "openclaw", "npm")), false);
  assert.equal(existsSync(path.join(dest, "openclaw", "agents", "knot-admin", "agent", "memory.sqlite-shm")), false);
  assert.equal(existsSync(path.join(dest, "openclaw", "agents", "knot-admin", "agent", "x-lock.sqlite")), false);

  // --config-only 不碰数据库和上传目录。
  assert.equal(existsSync(path.join(dest, "knot.dump")), false);

  const manifest = readFileSync(path.join(dest, "manifest.txt"), "utf8");
  assert.match(manifest, /^config_only=1$/m);
  assert.match(manifest, /^sites_status=backed-up$/m);
  assert.match(manifest, /^openclaw_status=backed-up$/m);
  assert.doesNotMatch(manifest, /^database_bytes=/m);
});

test("快照目录只给属主，密钥沿用源权限", { skip: !HAS_RSYNC }, () => {
  const ctx = scaffold();
  run(ctx);
  const [stamp] = snapshotDirs(ctx.backups);
  const dest = path.join(ctx.backups, stamp);

  assert.equal(statSync(dest).mode & 0o777, 0o700);
  assert.equal(statSync(path.join(dest, "sites", "demo", "platform.env")).mode & 0o777, 0o600);
  assert.equal(statSync(path.join(dest, "openclaw", "credentials", "relay.secret")).mode & 0o777, 0o600);
});

test("第二份快照用硬链接复用没变的文件", { skip: !HAS_RSYNC }, () => {
  const ctx = scaffold();
  run(ctx);
  run(ctx);
  const [a, b] = snapshotDirs(ctx.backups);
  assert.ok(a && b && a !== b, "需要两份不同的快照");

  const left = statSync(path.join(ctx.backups, a, "sites", "demo", "platform.env")).ino;
  const right = statSync(path.join(ctx.backups, b, "sites", "demo", "platform.env")).ino;
  assert.equal(left, right);
});

test("latest 指向最后一份快照", { skip: !HAS_RSYNC }, () => {
  const ctx = scaffold();
  run(ctx);
  run(ctx);
  const last = snapshotDirs(ctx.backups).at(-1);
  const link = path.join(ctx.backups, "latest");
  assert.equal(statSync(link).ino, statSync(path.join(ctx.backups, last)).ino);
});

test("保留份数按 KNOT_BACKUP_KEEP 清理", { skip: !HAS_RSYNC }, () => {
  const ctx = scaffold({ siteEnv: ["KNOT_BACKUP_KEEP=2"] });
  run(ctx);
  run(ctx);
  run(ctx);
  assert.equal(snapshotDirs(ctx.backups).length, 2);
});

test("KNOT_BACKUP_SITES=0 只备份数据库相关部分", { skip: !HAS_RSYNC }, () => {
  const ctx = scaffold({ siteEnv: ["KNOT_BACKUP_SITES=0"] });
  run(ctx);
  const [stamp] = snapshotDirs(ctx.backups);
  const dest = path.join(ctx.backups, stamp);
  assert.equal(existsSync(path.join(dest, "sites")), false);
  assert.match(readFileSync(path.join(dest, "manifest.txt"), "utf8"), /^sites_status=skipped$/m);
});

test("强制备份 OpenClaw 但目录不存在时失败且不留半份快照", { skip: !HAS_RSYNC }, () => {
  const ctx = scaffold({ siteEnv: ["KNOT_BACKUP_OPENCLAW=1"] });
  rmSync(path.join(ctx.home, ".openclaw"), { recursive: true, force: true });

  assert.throws(() => run(ctx), /Command failed/);
  assert.deepEqual(snapshotDirs(ctx.backups), []);
});
