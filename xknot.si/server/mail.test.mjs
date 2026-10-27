import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";

import {
  buildMessage,
  createMailer,
  isTransientMailError,
  mailConfigFromEnv,
  mailErrorCode,
  parseMailbox,
} from "./mail.mjs";

function decodeSubject(value) {
  const match = /^=\?UTF-8\?B\?([^?]+)\?=$/.exec(value.trim());
  return match ? Buffer.from(match[1], "base64").toString("utf8") : value;
}

function splitMessage(data) {
  const index = data.indexOf("\r\n\r\n");
  const head = data.slice(0, index);
  const body = data.slice(index + 4);
  const headers = {};
  for (const line of head.split("\r\n")) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    headers[line.slice(0, colon).toLowerCase()] = line.slice(colon + 1).trim();
  }
  return { headers, text: Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8") };
}

// 一个只认 LOGIN 的假 SMTP：够验证命令顺序、认证和 DATA 内容。
// dotReply / rcptReply 让测试替换某一步的应答，用来复现收信端的 4xx / 5xx。
function fakeSmtp(t, { dotReply = "250 2.0.0 queued\r\n", rcptReply = "250 2.1.5 ok\r\n" } = {}) {
  const seen = { mailFrom: null, rcptTo: [], data: null, authUser: null, authPass: null };
  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    let buffer = "";
    let inData = false;
    let body = "";
    let authStep = null;
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
            seen.data = body;
            body = "";
            socket.write(dotReply);
          } else {
            body += `${line}\r\n`;
          }
          continue;
        }

        if (authStep === "user") {
          seen.authUser = Buffer.from(line, "base64").toString("utf8");
          authStep = "pass";
          socket.write("334 UGFzc3dvcmQ6\r\n");
          continue;
        }
        if (authStep === "pass") {
          seen.authPass = Buffer.from(line, "base64").toString("utf8");
          authStep = null;
          socket.write("235 2.7.0 accepted\r\n");
          continue;
        }

        if (/^EHLO /i.test(line)) {
          socket.write("250-fake\r\n250-AUTH LOGIN PLAIN\r\n250 SIZE 10485760\r\n");
        } else if (/^AUTH LOGIN$/i.test(line)) {
          authStep = "user";
          socket.write("334 VXNlcm5hbWU6\r\n");
        } else if (/^MAIL FROM:/i.test(line)) {
          seen.mailFrom = line.slice(line.indexOf(":") + 1).trim();
          socket.write("250 2.1.0 ok\r\n");
        } else if (/^RCPT TO:/i.test(line)) {
          seen.rcptTo.push(line.slice(line.indexOf(":") + 1).trim());
          socket.write(rcptReply);
        } else if (/^DATA$/i.test(line)) {
          inData = true;
          socket.write("354 send it\r\n");
        } else if (/^QUIT$/i.test(line)) {
          socket.write("221 bye\r\n");
          socket.end();
        } else {
          socket.write("250 ok\r\n");
        }
      }
    });

    socket.on("error", () => {});
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      t.after(() => new Promise((done) => server.close(done)));
      resolve({ server, seen, port: server.address().port });
    });
  });
}

test("mail: config reads SMTP_* with MAIL_FROM precedence", () => {
  const config = mailConfigFromEnv({
    SMTP_HOST: "smtpdm.aliyun.com",
    SMTP_PORT: "465",
    SMTP_SECURE: "1",
    SMTP_USER: "noreply@mail.xknot.si",
    SMTP_PASS: "secret",
    SMTP_FROM: "old@mail.xknot.si",
    MAIL_FROM: "notify@mail.xknot.si",
    XKNOT_ADMIN_EMAIL: "admin@example.com",
    XKNOT_PUBLIC_ORIGIN: "https://xknot.si/",
  });
  assert.equal(config.host, "smtpdm.aliyun.com");
  assert.equal(config.port, 465);
  assert.equal(config.secure, true);
  assert.equal(config.from, "notify@mail.xknot.si");
  assert.equal(config.adminEmail, "admin@example.com");
  assert.equal(config.origin, "https://xknot.si");
  assert.equal(mailConfigFromEnv({ SMTP_PORT: "587" }), null);
  assert.equal(mailConfigFromEnv({ SMTP_HOST: "h", MAIL_FROM: "a@b.c", SMTP_PORT: "99999" }), null);
});

test("mail: message is UTF-8 base64 with an encoded subject and Reply-To", () => {
  const message = buildMessage({
    from: "XKnot 联邦 <notify@mail.xknot.si>",
    to: "lin@example.com",
    subject: "新申请 · 北港",
    text: "第一行\n第二行",
    replyTo: "lin@example.com",
    date: new Date("2026-10-19T12:00:00Z"),
  });
  assert.equal(message.envelopeFrom, "notify@mail.xknot.si");
  assert.equal(message.envelopeTo, "lin@example.com");
  assert.match(message.data, /Reply-To: lin@example\.com/);
  assert.match(message.data, /Date: Mon, 19 Oct 2026 12:00:00 GMT/);

  const parsed = splitMessage(message.data);
  assert.equal(decodeSubject(parsed.headers.subject), "新申请 · 北港");
  assert.equal(parsed.text, "第一行\n第二行");
});

test("mail: header injection is stripped, malformed mailboxes are refused", () => {
  const message = buildMessage({
    from: "a@b.c",
    to: "d@e.f",
    subject: "hello\r\nBcc: evil@example.com",
    text: "x",
  });
  assert.ok(!message.data.includes("\r\nBcc:"));
  assert.equal(parseMailbox("Name <a@b.c>").address, "a@b.c");
  assert.equal(parseMailbox("a@b.c\r\nBcc: d@e.f"), null);
  assert.throws(() => buildMessage({ from: "a@b.c", to: "nope", subject: "s", text: "t" }), /invalid_to/);
});

test("mail: sends EHLO, AUTH LOGIN, MAIL FROM, RCPT TO and DATA", { timeout: 5000 }, async (t) => {
  const { seen, port } = await fakeSmtp(t);
  const mailer = createMailer({
    host: "127.0.0.1",
    port,
    secure: false,
    allowInsecure: true,
    user: "notify@mail.xknot.si",
    pass: "Passw0rdPassw0rd",
    from: "notify@mail.xknot.si",
  });

  await mailer.send({
    to: "lin@example.com",
    subject: "测试",
    text: "正文",
  });

  assert.equal(seen.authUser, "notify@mail.xknot.si");
  assert.equal(seen.authPass, "Passw0rdPassw0rd");
  assert.equal(seen.mailFrom, "<notify@mail.xknot.si>");
  assert.deepEqual(seen.rcptTo, ["<lin@example.com>"]);
  const parsed = splitMessage(seen.data);
  assert.equal(decodeSubject(parsed.headers.subject), "测试");
  assert.equal(parsed.text, "正文");
});

test("mail: plaintext is refused unless explicitly allowed", { timeout: 5000 }, async (t) => {
  const { port } = await fakeSmtp(t);
  const mailer = createMailer({
    host: "127.0.0.1",
    port,
    secure: false,
    allowInsecure: false,
    user: "",
    pass: "",
    from: "a@b.c",
  });
  await assert.rejects(() => mailer.send({ to: "d@e.f", subject: "s", text: "t" }), /smtp_tls_required/);
});

function openMailer(port) {
  return createMailer({
    host: "127.0.0.1",
    port,
    secure: false,
    allowInsecure: true,
    user: "",
    pass: "",
    from: "notify@mail.xknot.si",
  });
}

// 收信端说「慢一点」时，那句话是运维唯一的线索：421 只说「稍后」，
// 原因在 4.7.28 和它后面那句里。丢掉就等于把 550 和 421 混成同一个「失败了」。
test("mail: a 4xx keeps the server's words, the enhanced status and the transient flag", { timeout: 5000 }, async (t) => {
  const { port } = await fakeSmtp(t, {
    dotReply: "421 4.7.28 review our Bulk Email Senders Guidelines. d9443c01a7336 - gsmtp\r\n",
  });
  await assert.rejects(
    () => openMailer(port).send({ to: "lin@example.com", subject: "s", text: "t" }),
    (error) => {
      assert.equal(error.code, "smtp_data");
      assert.equal(error.responseCode, 421);
      assert.equal(error.enhancedStatus, "4.7.28");
      assert.equal(error.transient, true);
      assert.match(error.replyText, /Bulk Email Senders Guidelines/);
      // 写进发信记录的是码，短且可聚合。
      assert.equal(mailErrorCode(error), "421 4.7.28");
      assert.equal(isTransientMailError(error), true);
      return true;
    }
  );
});

test("mail: a 5xx is permanent, and the recipient address is masked in the kept text", { timeout: 5000 }, async (t) => {
  const { port } = await fakeSmtp(t, {
    dotReply: "550 5.1.1 <lin@example.com>: Recipient address rejected: User unknown\r\n",
  });
  await assert.rejects(
    () => openMailer(port).send({ to: "lin@example.com", subject: "s", text: "t" }),
    (error) => {
      assert.equal(error.responseCode, 550);
      assert.equal(error.enhancedStatus, "5.1.1");
      assert.equal(error.transient, false);
      assert.equal(isTransientMailError(error), false);
      assert.equal(mailErrorCode(error), "550 5.1.1");
      // 发信记录不存完整地址，保留下来的原话也不能带一个。
      assert.match(error.replyText, /l\*\*\*@example\.com/);
      assert.ok(!error.replyText.includes("lin@example.com"));
      return true;
    }
  );
});

test("mail: a rejection at RCPT TO names that stage, not a generic command", { timeout: 5000 }, async (t) => {
  const { port } = await fakeSmtp(t, { rcptReply: "452 4.2.2 mailbox full\r\n" });
  await assert.rejects(
    () => openMailer(port).send({ to: "lin@example.com", subject: "s", text: "t" }),
    (error) => {
      assert.equal(error.code, "smtp_rcpt_to");
      assert.equal(mailErrorCode(error), "452 4.2.2");
      return true;
    }
  );
});

test("mail: a reply with no number falls back to the error code, not a made-up one", () => {
  assert.equal(mailErrorCode(null), "send_failed");
  assert.equal(mailErrorCode(new Error("smtp_timeout")), "smtp_timeout");
  assert.equal(isTransientMailError(new Error("smtp_timeout")), true);
  assert.equal(isTransientMailError(new Error("smtp_auth_unsupported")), false);
});

// 重试同一封信要复用同一个 Message-ID：收信端按它去重，换一个就等于
// 告诉对方这是另一封信，同一条通知会真的投两遍。
test("mail: a retry keeps the message id, and a malformed one is refused", () => {
  const header = (data) => /^Message-ID: (.*)$/m.exec(data)[1];

  const first = buildMessage({ from: "notify@mail.xknot.si", to: "a@b.c", subject: "s", text: "t", messageId: "0123456789abcdef" });
  const again = buildMessage({ from: "notify@mail.xknot.si", to: "a@b.c", subject: "s", text: "t", messageId: "0123456789abcdef" });
  assert.equal(header(first.data), "<0123456789abcdef@mail.xknot.si>");
  assert.equal(header(again.data), header(first.data));

  // 域名由发信地址补，调用方拼不出第二个域、`>` 或换行。
  const injected = buildMessage({
    from: "notify@mail.xknot.si",
    to: "a@b.c",
    subject: "s",
    text: "t",
    messageId: "0123456789abcdef@evil.test>\r\nBcc: x@y.z",
  });
  assert.ok(!injected.data.includes("Bcc:"));
  assert.match(header(injected.data), /^<[0-9a-f]{24}@mail\.xknot\.si>$/);
});
