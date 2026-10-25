import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = path.join(HERE, "config.mjs");

// 在临时部署根里跑 config.mjs join：sites/ 由 KNOT_DEPLOY_ROOT 指过去，不碰真实站点。
async function deployRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "knot-join-"));
  await mkdir(path.join(root, "sites", "demo"), { recursive: true });
  await writeFile(
    path.join(root, "sites", "demo", "site.env"),
    "KNOT_DOMAIN=demo.example\nKNOT_PUBLIC_ORIGIN=https://demo.example\n"
  );
  return root;
}

function join(root, payload) {
  return spawnSync(process.execPath, [CONFIG, "join", "--site", "demo", "--in", payload], {
    env: { ...process.env, KNOT_DEPLOY_ROOT: root },
    encoding: "utf8",
  });
}

async function writePayload(root, name, lines) {
  const file = path.join(root, name);
  await writeFile(file, `${lines.join("\n")}\n`);
  return file;
}

test("接入件写进 xknot.env，权限 600，发信地址留空由中枢地址推导", async () => {
  const root = await deployRoot();
  const payload = await writePayload(root, "access.env", [
    "XKNOT_INSTANCE_ID=wang",
    "XKNOT_HUB_ORIGIN=https://xknot.si",
    "XKNOT_HUB_RELAY_TOKEN=xkr_wang_0123456789abcdef",
    "XKNOT_ISSUED_AT=2026-10-20",
  ]);

  const result = join(root, payload);
  assert.equal(result.status, 0, result.stderr);

  const file = path.join(root, "sites", "demo", "xknot.env");
  const text = await readFile(file, "utf8");
  assert.match(text, /^XKNOT_INSTANCE_ID=wang$/m);
  assert.match(text, /^XKNOT_HUB_RELAY_TOKEN=xkr_wang_0123456789abcdef$/m);
  assert.match(text, /^XKNOT_HUB_RELAY_URL=$/m);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
});

test("单独给地址不给凭据会被拒绝，旧文件不动", async () => {
  const root = await deployRoot();
  const first = await writePayload(root, "first.env", [
    "XKNOT_INSTANCE_ID=wang",
    "XKNOT_HUB_RELAY_TOKEN=xkr_wang_0123456789abcdef",
  ]);
  assert.equal(join(root, first).status, 0);

  const file = path.join(root, "sites", "demo", "xknot.env");
  const before = await readFile(file, "utf8");
  const orphan = await writePayload(root, "orphan.env", [
    "XKNOT_INSTANCE_ID=wang",
    "XKNOT_HUB_RELAY_URL=https://elsewhere.test/api/federation/mail",
  ]);
  const result = join(root, orphan);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /XKNOT_HUB_RELAY_TOKEN/);
  assert.equal(await readFile(file, "utf8"), before);
});

test("重领一份新凭据会清掉旧的地址覆盖，不带凭据则保留原凭据", async () => {
  const root = await deployRoot();
  const file = path.join(root, "sites", "demo", "xknot.env");

  // 第一份：带地址覆盖与旧凭据。
  const first = await writePayload(root, "first.env", [
    "XKNOT_INSTANCE_ID=wang",
    "XKNOT_HUB_RELAY_URL=http://127.0.0.1:5181/api/federation/mail",
    "XKNOT_HUB_RELAY_TOKEN=xkr_wang_old000000000000",
  ]);
  assert.equal(join(root, first).status, 0);
  assert.match(await readFile(file, "utf8"), /^XKNOT_HUB_RELAY_URL=http:\/\/127\.0\.0\.1:5181/m);

  // 第二份只换凭据：旧地址属于上一份签发，一并清掉。
  const second = await writePayload(root, "second.env", [
    "XKNOT_INSTANCE_ID=wang",
    "XKNOT_HUB_RELAY_TOKEN=xkr_wang_new000000000000",
  ]);
  assert.equal(join(root, second).status, 0);
  const afterToken = await readFile(file, "utf8");
  assert.match(afterToken, /^XKNOT_HUB_RELAY_TOKEN=xkr_wang_new000000000000$/m);
  assert.match(afterToken, /^XKNOT_HUB_RELAY_URL=$/m);

  // 第三份不含凭据：沿用新凭据，不清空。
  const third = await writePayload(root, "third.env", ["XKNOT_INSTANCE_ID=wang", "XKNOT_ISSUED_AT=2026-10-21"]);
  assert.equal(join(root, third).status, 0);
  const afterKeep = await readFile(file, "utf8");
  assert.match(afterKeep, /^XKNOT_HUB_RELAY_TOKEN=xkr_wang_new000000000000$/m);
  assert.match(afterKeep, /^XKNOT_ISSUED_AT=2026-10-21$/m);
});

test("接入件里出现契约之外的键就整份拒绝，旧文件不动", async () => {
  // 改名或废弃的键不转换、不落盘：写进去也不会被读，等于把问题留到门户上少一行时
  // 才发现。要新键就让中枢用当前版本重签，接收方不替它猜。
  const root = await deployRoot();
  const file = path.join(root, "sites", "demo", "xknot.env");
  const first = await writePayload(root, "first.env", [
    "XKNOT_INSTANCE_ID=wang",
    "XKNOT_ISSUED_TIER=paid",
    "XKNOT_ISSUED_STATUS=active",
  ]);
  assert.equal(join(root, first).status, 0);
  const before = await readFile(file, "utf8");

  const legacy = await writePayload(root, "legacy.env", [
    "XKNOT_INSTANCE_ID=wang",
    "XKNOT_TIER=paid",
    "XKNOT_STATUS=active",
    "XKNOT_HUB_ISSUED_AT=2026-10-20",
  ]);

  const result = join(root, legacy);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /XKNOT_TIER/);
  assert.match(result.stderr, /XKNOT_STATUS/);
  assert.match(result.stderr, /XKNOT_HUB_ISSUED_AT/);
  assert.match(result.stderr, /重(新)?签/);
  assert.equal(await readFile(file, "utf8"), before);
});
