import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";

import { buildMessage, createMailer, mailConfigFromEnv, parseMailbox } from "./mail.mjs";

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
function fakeSmtp(t) {
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
            socket.write("250 2.0.0 queued\r\n");
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
          socket.write("250 2.1.5 ok\r\n");
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
    from: "Knot 联邦 <notify@mail.xknot.si>",
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
