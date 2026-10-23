// 签发与凭据命令行：这一层没有 HTTP，只能整体跑进程。
//
// 用临时目录里的库与两份 JSON 起真正的 `node server/admin-cli.mjs`，
// 看的都是它真正写出来的东西：文件权限、接入件的键、凭据有没有作废。

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { openStore } from "./store.mjs";

const exec = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, "admin-cli.mjs");

const APPLICATION = {
  id: "XK-2026-M5CMKG",
  name: "cpswang",
  subdomain: "cpswang",
  operator: "Paul",
  email: "manwjh@126.com",
  region: "CN",
  timezone: "Asia/Shanghai",
  intro: "自用实例。",
};

async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "xknot-cli-"));
  const manifestFile = path.join(dir, "instances.json");
  const rosterFile = path.join(dir, "federation.json");
  await writeFile(
    manifestFile,
    `${JSON.stringify(
      {
        version: 5,
        updatedAt: "2026-10-19",
        instances: [
          { id: "cpswang", url: "https://cpswang.xknot.si", since: "2026-10-19", tier: "free", status: "pending" },
        ],
      },
      null,
      2
    )}\n`
  );
  await writeFile(
    rosterFile,
    `${JSON.stringify(
      {
        version: 1,
        updatedAt: "2026-10-19",
        hub: "xknot.si",
        members: [
          {
            id: "cpswang",
            host: "cpswang.xknot.si",
            role: "partner",
            standing: "good",
            tunnel: { account: "knot-tunnel-cpswang", port: 18090 },
            listed: true,
            since: "2026-10-19",
            mode: "subdomain",
          },
        ],
      },
      null,
      2
    )}\n`
  );

  const store = openStore(path.join(dir, "xknot.db"));
  const application = store.createApplication(APPLICATION);
  store.close();

  // 只给命令行必要的环境：本机如果有 SMTP 变量，发信命令会真的去连。
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    XKNOT_DATA_DIR: dir,
    XKNOT_INSTANCES_FILE: manifestFile,
    XKNOT_FEDERATION_FILE: rosterFile,
    XKNOT_ADMIN_PASSWORD: "correct-horse-battery",
    XKNOT_ADMIN_USER: "paul",
  };

  async function cli(args) {
    try {
      const { stdout, stderr } = await exec(process.execPath, [CLI, ...args], { env, cwd: dir });
      return { code: 0, stdout, stderr };
    } catch (error) {
      return { code: error.code, stdout: error.stdout, stderr: error.stderr };
    }
  }

  return { dir, manifestFile, rosterFile, application, env, cli };
}

test("access: the file is 600 even when it already existed as 644", async (t) => {
  const { cli, dir, application } = await fixture(t);
  const out = path.join(dir, "cpswang.env");
  await writeFile(out, "old\n", { mode: 0o644 });

  const result = await cli(["access", application.id, "--id", "cpswang", "--out", out]);
  assert.equal(result.code, 0, result.stderr);

  // 里面的委托发信凭据是明文口令：覆盖一份老文件时 mode 不生效，必须写完再收。
  const mode = (await stat(out)).mode & 0o777;
  assert.equal(mode, 0o600);

  const text = await readFile(out, "utf8");
  // 消费方（knot-platform 的 join-xknot.sh）按 7.4 的键名读这一个。
  assert.match(text, /^XKNOT_HUB_ISSUED_AT=2026-10-19$/m);
  assert.match(text, /^XKNOT_INSTANCE_ID=cpswang$/m);
  assert.match(text, /^XKNOT_HUB_ORIGIN=https:\/\/xknot\.si$/m);
});

test("access: issuing again replaces the previous credential", async (t) => {
  const { cli, dir, application, env } = await fixture(t);
  const out = path.join(dir, "cpswang.env");

  const first = await cli(["access", application.id, "--id", "cpswang", "--daily", "20", "--out", out]);
  assert.equal(first.code, 0, first.stderr);
  assert.match(await readFile(out, "utf8"), /^XKNOT_HUB_RELAY_TOKEN=xkr_\S+$/m);

  const second = await cli(["access", application.id, "--id", "cpswang", "--out", out]);
  assert.equal(second.code, 0, second.stderr);
  // 终端要说清旧件已经作废：运营看到这句才知道不必再追着回收。
  assert.match(second.stderr, /已作废/);

  const store = openStore(path.join(env.XKNOT_DATA_DIR, "xknot.db"));
  t.after(() => store.close());
  const tokens = store.listRelayTokens().filter((token) => token.instanceId === "cpswang");
  assert.equal(tokens.length, 2);
  assert.equal(tokens.filter((token) => !token.revokedAt).length, 1, "同时只有一份有效");
  assert.ok(tokens.some((token) => token.revokedAt && token.dailyLimit === 20));
});

test("access: a relay credential is issued by default, and --no-relay revokes the old one", async (t) => {
  const { cli, dir, application, env } = await fixture(t);

  const out = path.join(dir, "cpswang.env");
  const byDefault = await cli(["access", application.id, "--id", "cpswang", "--out", out]);
  assert.equal(byDefault.code, 0, byDefault.stderr);
  assert.match(await readFile(out, "utf8"), /^XKNOT_HUB_RELAY_TOKEN=xkr_\S+$/m);

  // 不要发信能力时明确关掉：文件里没有凭据，库里那份也一并作废。
  const smtpOnly = path.join(dir, "cpswang-smtp.env");
  const off = await cli(["access", application.id, "--id", "cpswang", "--no-relay", "--out", smtpOnly]);
  assert.equal(off.code, 0, off.stderr);
  assert.doesNotMatch(await readFile(smtpOnly, "utf8"), /^XKNOT_HUB_RELAY_TOKEN=xkr_/m);

  const store = openStore(path.join(env.XKNOT_DATA_DIR, "xknot.db"));
  t.after(() => store.close());
  const tokens = store.listRelayTokens().filter((token) => token.instanceId === "cpswang");
  assert.equal(tokens.filter((token) => !token.revokedAt).length, 0, "no usable credential is left");
});

test("relay-disable / relay-enable: one switch per instance, and the credential survives it", async (t) => {
  const { cli, env } = await fixture(t);
  const store = openStore(path.join(env.XKNOT_DATA_DIR, "xknot.db"));
  t.after(() => store.close());
  const issued = store.createRelayToken({ instanceId: "cpswang", dailyLimit: 30 });

  const off = await cli(["relay-disable", "cpswang", "--note", "退信率升高"]);
  assert.equal(off.code, 0, off.stderr);
  assert.equal(store.relaySwitch("cpswang").disabled, true);
  assert.equal(store.relaySwitch("cpswang").note, "退信率升高");
  // 暂停不是吊销：令牌照样能校验通过，额度也没变。
  assert.equal(store.verifyRelayToken(issued.token).token.instanceId, "cpswang");
  assert.equal(store.listRelayTokens()[0].dailyLimit, 30);

  // 列表要能看出是「关掉了」而不是「吊销了」。
  const listed = await cli(["relay-tokens"]);
  assert.match(listed.stdout, /已关闭（可恢复）/);

  const on = await cli(["relay-enable", "cpswang"]);
  assert.equal(on.code, 0, on.stderr);
  assert.equal(store.relaySwitch("cpswang").disabled, false);

  assert.notEqual((await cli(["relay-disable", "nosuch"])).code, 0);
  assert.notEqual((await cli(["relay-disable"])).code, 0);
});

test("access: a withdrawn application gets no credentials", async (t) => {
  const { cli, dir, application, env } = await fixture(t);
  const store = openStore(path.join(env.XKNOT_DATA_DIR, "xknot.db"));
  store.withdrawApplication(application.id);
  store.close();

  const out = path.join(dir, "cpswang.env");
  const result = await cli(["access", application.id, "--id", "cpswang", "--with-relay", "--out", out]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /withdrawn/);
});

test("publish: the roster is written with the manifest, and a second run is refused", async (t) => {
  const { cli, application, rosterFile, manifestFile } = await fixture(t);
  // 先把库里的这一条从两份文件里拿掉，模拟「还没发布」；名册要留一个 founder，
  // 校验器要求恰好一个，这是名册本身的结构，不是这一次发布带来的。
  await writeFile(
    manifestFile,
    `${JSON.stringify(
      {
        version: 5,
        updatedAt: "2026-10-19",
        instances: [{ id: "wang", url: "https://wang.xknot.si", since: "2026-10-19", tier: "paid", status: "active" }],
      },
      null,
      2
    )}\n`
  );
  await writeFile(
    rosterFile,
    `${JSON.stringify(
      {
        version: 1,
        updatedAt: "2026-10-19",
        hub: "xknot.si",
        members: [
          {
            id: "wang",
            host: "wang.xknot.si",
            role: "founder",
            standing: "permanent",
            tunnel: { account: "knot-tunnel", port: 18080 },
            listed: true,
            since: "2026-10-19",
            mode: "subdomain",
          },
        ],
      },
      null,
      2
    )}\n`
  );

  const args = ["publish", application.id, "--tunnel-account", "knot-tunnel-cpswang", "--tunnel-port", "18090"];
  const first = await cli(args);
  assert.equal(first.code, 0, first.stderr);

  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  const roster = JSON.parse(await readFile(rosterFile, "utf8"));
  assert.ok(manifest.instances.some((item) => item.id === "cpswang"));
  assert.equal(roster.members.find((item) => item.id === "cpswang").tunnel.port, 18090);

  const again = await cli(args);
  assert.equal(again.code, 1, "同一条不能再写一次");
  assert.match(again.stderr, /已有|占用/);
});
