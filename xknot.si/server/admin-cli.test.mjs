// 签发与凭据命令行：这一层没有 HTTP，只能整体跑进程。
//
// 用临时目录里的库与两份 JSON 起真正的 `node server/admin-cli.mjs`，
// 看的都是它真正写出来的东西：文件权限、接入件的键、凭据有没有作废。

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import net from "node:net";
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

async function fixture(t, extraEnv = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "xknot-cli-"));  const manifestFile = path.join(dir, "instances.json");
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
  // 需要真的发信时传 extraEnv（测试用本机假 SMTP），别读开发机上的那份配置。
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    XKNOT_DATA_DIR: dir,
    XKNOT_INSTANCES_FILE: manifestFile,
    XKNOT_FEDERATION_FILE: rosterFile,
    XKNOT_ADMIN_PASSWORD: "correct-horse-battery",
    XKNOT_ADMIN_USER: "paul",
    ...extraEnv,
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
  // 签发区一项一个键，与清单字段同名：档位就是清单里的档位，状态就是清单里的状态。
  assert.match(text, /^XKNOT_ISSUED_AT=2026-10-19$/m);
  assert.match(text, /^XKNOT_ISSUED_TIER=free$/m);
  assert.match(text, /^XKNOT_ISSUED_STATUS=pending$/m);
  assert.match(text, /^XKNOT_INSTANCE_ID=cpswang$/m);
  assert.match(text, /^XKNOT_HUB_ORIGIN=https:\/\/xknot\.si$/m);
  // 同义键不再签发：一份文件里同一个事实只能有一个键名。
  assert.doesNotMatch(text, /^XKNOT_HUB_ISSUED_AT=/m);
  assert.doesNotMatch(text, /^XKNOT_TIER=/m);
  assert.doesNotMatch(text, /^XKNOT_STATUS=/m);
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

// 一个只收信的假 SMTP：交付信走真 socket，才能验证「链接寄出去了」而不是「函数返回值对」。
// 不开 AUTH：命令行这边只设 SMTP_HOST / MAIL_FROM，认证不是这条用例要验的东西。
function fakeSmtp(t) {
  const messages = [];
  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    let buffer = "";
    let inData = false;
    let body = "";
    socket.write("220 fake ESMTP\r\n");

    socket.on("data", (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);

        if (inData) {
          if (line === ".") {
            inData = false;
            messages.push(body);
            body = "";
            socket.write("250 2.0.0 queued\r\n");
          } else {
            body += `${line}\r\n`;
          }
          continue;
        }

        if (/^EHLO /i.test(line)) socket.write("250-fake\r\n250 SIZE 10485760\r\n");
        else if (/^MAIL FROM:/i.test(line)) socket.write("250 2.1.0 ok\r\n");
        else if (/^RCPT TO:/i.test(line)) socket.write("250 2.1.5 ok\r\n");
        else if (/^DATA$/i.test(line)) {
          inData = true;
          socket.write("354 send it\r\n");
        } else if (/^QUIT$/i.test(line)) {
          socket.write("221 bye\r\n");
          socket.end();
        } else socket.write("250 ok\r\n");
      }
    });
    socket.on("error", () => {});
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      t.after(() => new Promise((done) => server.close(done)));
      resolve({ port: server.address().port, messages });
    });
  });
}

// 正文是 base64；去掉折行还原成邮件里真正写着的文本。
function mailText(message) {
  const index = message.indexOf("\r\n\r\n");
  const body = message.slice(index + 4).replace(/\r\n/g, "");
  return Buffer.from(body, "base64").toString("utf8");
}

function claimTokenOf(text) {
  const match = /\/claim\/([A-Za-z0-9_-]{8,})/.exec(text);
  return match ? match[1] : null;
}

test("handoff: the mail carries the link, and a resend retires the previous one", async (t) => {
  const smtp = await fakeSmtp(t);
  const { cli, dir, application, env } = await fixture(t, {
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: String(smtp.port),
    SMTP_ALLOW_INSECURE: "1",
    MAIL_FROM: "notify@mail.xknot.si",
    XKNOT_PUBLIC_ORIGIN: "https://hub.example",
  });
  const payload = path.join(dir, "cpswang.env");
  await writeFile(payload, "XKNOT_HUB_RELAY_TOKEN=xkr_do_not_leak\n", { mode: 0o600 });

  const first = await cli(["handoff", application.id, "--payload", payload, "--ttl", "24"]);
  assert.equal(first.code, 0, first.stderr);
  assert.match(first.stdout, /https:\/\/hub\.example\/claim\//);
  // 有效期照参数写进信里：写死 72 小时就是在骗伙伴。
  assert.match(first.stdout, /24 小时后失效/);

  const sent = mailText(smtp.messages[0]);
  const firstToken = claimTokenOf(sent);
  assert.ok(firstToken, "the mail must carry the claim link");
  // 这单没有 locale，信按默认英文出；有效期照参数写成 24 小时。
  assert.match(sent, /24 hours/);
  // 资料本身不进信：信里只有领取链接。
  assert.ok(!sent.includes("xkr_do_not_leak"), "secrets never go into mail");

  // 资料轮换后重发：旧链接必须当场作废，否则两封信各能领出一份。
  await writeFile(payload, "XKNOT_HUB_RELAY_TOKEN=xkr_rotated\n", { mode: 0o600 });
  const second = await cli(["handoff", application.id, "--payload", payload]);
  assert.equal(second.code, 0, second.stderr);
  assert.match(second.stdout, /已作废 1 条旧领取链接/);

  const store = openStore(path.join(env.XKNOT_DATA_DIR, "xknot.db"));
  t.after(() => store.close());
  const rows = store.listClaimTokens({ applicationId: application.id });
  assert.equal(rows.length, 2);
  assert.equal(rows.filter((row) => row.revokedAt).length, 1);
  assert.equal(rows.filter((row) => !row.revokedAt && !row.usedAt).length, 1);
  // 旧令牌在库里只剩哈希，校验走的是真令牌；这里用「旧的已作废」间接确认。
  const [latest] = rows.filter((row) => !row.revokedAt);
  assert.equal(latest.payloadLength > 0, true);
});

test("handoff: no SMTP means no claim link, unless --offline asks for one", async (t) => {
  const { cli, dir, application, env } = await fixture(t);
  const payload = path.join(dir, "cpswang.env");
  await writeFile(payload, "XKNOT_HUB_RELAY_TOKEN=xkr_offline\n", { mode: 0o600 });

  // 信发不出去时先造链接，就会留下一条谁也拿不到的领取记录。
  const refused = await cli(["handoff", application.id, "--payload", payload]);
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /SMTP|MAIL_FROM/);
  assert.match(refused.stderr, /--offline/);

  const store = openStore(path.join(env.XKNOT_DATA_DIR, "xknot.db"));
  t.after(() => store.close());
  assert.deepEqual(store.listClaimTokens({ applicationId: application.id }), []);

  // 线下转交仍然是合法的路：只打印链接，不碰 SMTP。
  const offline = await cli(["handoff", application.id, "--payload", payload, "--offline"]);
  assert.equal(offline.code, 0, offline.stderr);
  assert.match(offline.stdout, /未寄信/);
  const token = claimTokenOf(offline.stdout);
  assert.ok(token);
  assert.equal(store.consumeClaimToken(token).payload, "XKNOT_HUB_RELAY_TOKEN=xkr_offline");
});

test("handoff: var/mail.env supplies SMTP when the shell has none", async (t) => {
  const smtp = await fakeSmtp(t);
  const { cli, dir, application } = await fixture(t);
  // 生产由 systemd 的 EnvironmentFile 读这份文件；手工跑命令行时由 CLI 自己补，
  // 否则同一台机器上「接口能发信、终端说没配置」。
  await writeFile(
    path.join(dir, "mail.env"),
    [
      "SMTP_HOST=127.0.0.1",
      `SMTP_PORT=${smtp.port}`,
      "SMTP_ALLOW_INSECURE=1",
      "MAIL_FROM=notify@mail.xknot.si",
      "XKNOT_PUBLIC_ORIGIN=https://hub.example",
    ].join("\n"),
    { mode: 0o600 }
  );
  const payload = path.join(dir, "cpswang.env");
  await writeFile(payload, "XKNOT_HUB_RELAY_TOKEN=xkr_from_file\n", { mode: 0o600 });

  const result = await cli(["handoff", application.id, "--payload", payload]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /https:\/\/hub\.example\/claim\//);
  assert.equal(smtp.messages.length, 1);
});

test("claims / claim-revoke: states are visible, and revoking is explicit", async (t) => {
  const { cli, dir, application, env } = await fixture(t);
  const payload = path.join(dir, "cpswang.env");
  await writeFile(payload, "XKNOT_HUB_RELAY_TOKEN=xkr_state\n", { mode: 0o600 });

  const issued = await cli(["handoff", application.id, "--payload", payload, "--offline"]);
  assert.equal(issued.code, 0, issued.stderr);

  const store = openStore(path.join(env.XKNOT_DATA_DIR, "xknot.db"));
  t.after(() => store.close());
  const [row] = store.listClaimTokens({ applicationId: application.id });

  const listed = await cli(["claims", application.id]);
  assert.equal(listed.code, 0, listed.stderr);
  assert.match(listed.stdout, /可领取/);
  assert.match(listed.stdout, new RegExp(row.id));
  assert.ok(!listed.stdout.includes("xkr_state"), "领取列表不给明文");

  const revoked = await cli(["claim-revoke", row.id]);
  assert.equal(revoked.code, 0, revoked.stderr);
  assert.match(revoked.stdout, /已作废领取链接/);
  assert.match((await cli(["claims", application.id])).stdout, /已作废/);

  // 再收一次没有可收的：命令行要说清楚，而不是静默成功。
  const again = await cli(["claim-revoke", row.id]);
  assert.equal(again.code, 1);
  assert.match(again.stderr, /没有可作废的领取记录/);
});

test("notify: partner.handoff cannot be resent without a link", async (t) => {
  const { cli, application } = await fixture(t);
  const result = await cli(["notify", application.id, "partner.handoff"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /handoff/);
});
// 退信闭环：中枢收不到退信（MX 指向阿里云），只能由人把控制台里的
// Message-ID 抄回来。抄错不能猜，猜错就是把一封送到了的信标成退回。
test("bounce: a message id from the provider closes the loop, a wrong one does not", async (t) => {
  const { cli, env } = await fixture(t);

  const store = openStore(path.join(env.XKNOT_DATA_DIR, "xknot.db"));
  const row = store.beginNotify({
    event: "partner.approved",
    caseId: "XK-2026-M5CMKG",
    stateVersion: 0,
    messageId: "0123456789abcdef01234567",
  });
  store.finishNotify(row.id, { status: "sent" });
  store.close();

  // 退信报告里是带尖括号和域的整段，命令行两种写法都要认。
  const closed = await cli(["bounce", "<0123456789abcdef01234567@xknot.si>", "--note", "5.1.1 user unknown"]);
  assert.equal(closed.code, 0, closed.stderr);
  assert.match(closed.stdout, /已标记退回/);

  const reopened = openStore(path.join(env.XKNOT_DATA_DIR, "xknot.db"));
  t.after(() => reopened.close());
  const [bounced] = reopened.listNotifyLog(10, "XK-2026-M5CMKG");
  assert.equal(bounced.status, "bounced");
  assert.match(bounced.error, /5\.1\.1/);

  // 同一个号再抄一遍：已经没有可改的行，要明确说，不能静默成功。
  const again = await cli(["bounce", "0123456789abcdef01234567"]);
  assert.equal(again.code, 1);
});

test("bounce: an unknown message id is refused instead of guessed", async (t) => {
  const { cli } = await fixture(t);
  const result = await cli(["bounce", "<deadbeefdeadbeefdeadbeef@xknot.si>"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /没有这个 Message-ID/);
});
