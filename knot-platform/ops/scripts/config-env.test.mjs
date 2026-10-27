import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = path.join(HERE, "config.mjs");

// 在临时部署根里跑 config.mjs env：站点目录由 KNOT_DEPLOY_ROOT 指过去，不碰真实站点。
async function deployRoot(platformLines = []) {
  const root = await mkdtemp(path.join(tmpdir(), "knot-env-"));
  await mkdir(path.join(root, "sites", "demo"), { recursive: true });
  await writeFile(
    path.join(root, "sites", "demo", "site.env"),
    "KNOT_ADMIN_EMAIL=admin@example.com\nKNOT_PUBLIC_ORIGIN=http://127.0.0.1:8081\nKNOT_BACKUP_DIR=/tmp/knot-backups\n"
  );
  const platform = path.join(root, "sites", "demo", "platform.env");
  await writeFile(platform, `${platformLines.join("\n")}\n`, { mode: 0o600 });
  return { root, platform };
}

function runEnv(root, { extraEnv = {} } = {}) {
  return spawnSync(
    process.execPath,
    [
      CONFIG,
      "env",
      "--site",
      "demo",
      "--out",
      path.join(root, "sites", "demo", "platform.env"),
      "--root",
      path.join(root, "current"),
      "--deploy-root",
      root,
    ],
    { env: { ...process.env, ...extraEnv, KNOT_DEPLOY_ROOT: root }, encoding: "utf8" }
  );
}

const RETIRED = [
  "KNOT_SITE=demo",
  "KNOT_ADMIN_EMAIL=admin@example.com",
  "KNOT_SERVICE_USER=knot",
  "KNOT_SYSTEMD_DIR=/etc/systemd/system",
];

test("写运行时配置时清掉已删除的 Linux 键，并说一句为什么", async () => {
  const { root, platform } = await deployRoot(RETIRED);
  const result = runEnv(root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /已删除的键：.*KNOT_SYSTEMD_DIR.*KNOT_SERVICE_USER|已删除的键：.*KNOT_SERVICE_USER.*KNOT_SYSTEMD_DIR/);

  const text = await readFile(platform, "utf8");
  assert.doesNotMatch(text, /^KNOT_SYSTEMD_DIR=/m);
  assert.doesNotMatch(text, /^KNOT_SERVICE_USER=/m);
});

test("没传 KNOT_NODE_BIN 时保留已经验过的绝对路径", async () => {
  // 手动跑 config.mjs env（改个价格、补个邮箱）不该把部署时验过的 node 路径清空：
  // 服务脚本会退回 PATH 里的 node，launchd 下没有 /opt/homebrew/bin，就成了起不来。
  const { root, platform } = await deployRoot([...RETIRED, "KNOT_NODE_BIN=/opt/homebrew/bin/node"]);
  const result = runEnv(root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(await readFile(platform, "utf8"), /^KNOT_NODE_BIN=\/opt\/homebrew\/bin\/node$/m);
});

test("部署脚本传了新路径时以传入值为准", async () => {
  const { root, platform } = await deployRoot([...RETIRED, "KNOT_NODE_BIN=/opt/homebrew/bin/node"]);
  const result = runEnv(root, { extraEnv: { KNOT_NODE_BIN: "/usr/local/opt/node@22/bin/node" } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(await readFile(platform, "utf8"), /^KNOT_NODE_BIN=\/usr\/local\/opt\/node@22\/bin\/node$/m);
});
