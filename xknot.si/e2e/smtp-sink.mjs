// 端到端用的最小 SMTP 收信器。
//
// 只实现 server/mail.mjs 会走的那几步：220 问候、EHLO、MAIL FROM、RCPT TO、
// DATA、QUIT。不宣告 STARTTLS，也不要求认证，所以被测接口用
// SMTP_ALLOW_INSECURE=1 + 空 SMTP_USER 就能把信投进来。
//
// 收到的每封信解析成 { from, to, subject, replyTo, body, headers }，
// 正文按 Content-Transfer-Encoding 解出来，测试直接断言。

import net from "node:net";

/** RFC 2047 的 B 编码头，mail.mjs 对非 ASCII 主题会这样编码。 */
function decodeHeader(value) {
  return String(value).replace(/=\?UTF-8\?B\?([^?]+)\?=/gi, (_match, encoded) =>
    Buffer.from(encoded, "base64").toString("utf8")
  );
}

function parseMessage(raw) {
  const split = raw.indexOf("\r\n\r\n");
  const head = split >= 0 ? raw.slice(0, split) : raw;
  const body = split >= 0 ? raw.slice(split + 4) : "";
  const headers = {};
  let last = null;
  for (const line of head.split("\r\n")) {
    if (/^[ \t]/.test(line) && last) {
      headers[last] += ` ${line.trim()}`;
      continue;
    }
    const index = line.indexOf(":");
    if (index <= 0) continue;
    last = line.slice(0, index).trim().toLowerCase();
    headers[last] = line.slice(index + 1).trim();
  }
  const bodyText = /base64/i.test(headers["content-transfer-encoding"] || "")
    ? Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8")
    : body;
  return {
    headers,
    from: decodeHeader(headers.from || ""),
    to: decodeHeader(headers.to || ""),
    subject: decodeHeader(headers.subject || ""),
    replyTo: decodeHeader(headers["reply-to"] || ""),
    body: bodyText,
    raw,
  };
}

export function startSmtpSink({ port = 0, host = "127.0.0.1" } = {}) {
  const messages = [];
  const sockets = new Set();
  // EHLO 里宣告的 SIZE 要真的执行，否则一条没有终止符的 DATA 能把缓冲撑爆（S24-14）。
  const MAX_MESSAGE_BYTES = 1024 * 1024;
  // 命令行长度的上限：没有它，一个不发 CRLF 的客户端也能让 buffer 无限长。
  const MAX_COMMAND_BYTES = 4096;
  // 收信器活到整个测试文件结束：只留最近这些封，别把内存长成历史总量。
  const MAX_MESSAGES = 200;

  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.setEncoding("utf8");
    socket.write("220 e2e-sink ESMTP\r\n");

    let buffer = "";
    let inData = false;
    let data = "";
    let from = "";
    let to = [];

    const tooLarge = () => {
      socket.write("552 5.3.4 message size exceeds fixed maximum message size\r\n");
      socket.destroy();
    };

    socket.on("data", (chunk) => {
      buffer += chunk;

      if (inData) {
        // 终止符之前就已经超了：不必再等它，直接按宣称的 SIZE 拒绝。
        if (Buffer.byteLength(buffer, "utf8") > MAX_MESSAGE_BYTES) {
          tooLarge();
          return;
        }
      } else if (buffer.indexOf("\r\n") < 0 && Buffer.byteLength(buffer, "utf8") > MAX_COMMAND_BYTES) {
        socket.write("500 5.5.2 line too long\r\n");
        socket.destroy();
        return;
      }

      for (;;) {
        if (inData) {
          const end = buffer.indexOf("\r\n.\r\n");
          if (end < 0) return;
          data += buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          inData = false;
          // dot-unstuffing，与真实 SMTP 一致。
          const raw = data.replace(/(^|\r\n)\.\./g, "$1.");
          messages.push({ envelopeFrom: from, envelopeTo: to, ...parseMessage(raw) });
          if (messages.length > MAX_MESSAGES) messages.shift();
          data = "";
          from = "";
          to = [];
          socket.write("250 2.0.0 queued\r\n");
          continue;
        }

        const index = buffer.indexOf("\r\n");
        if (index < 0) return;
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const upper = line.toUpperCase();

        if (upper.startsWith("EHLO") || upper.startsWith("HELO")) {
          socket.write("250-e2e-sink\r\n250-8BITMIME\r\n250 SIZE 1048576\r\n");
        } else if (upper.startsWith("MAIL FROM")) {
          // 声明了就核对：SIZE 超过上限的会话不该再收它的 DATA。
          const declared = /SIZE=(\d+)/i.exec(line);
          if (declared && Number(declared[1]) > MAX_MESSAGE_BYTES) {
            tooLarge();
            return;
          }
          const match = /<([^>]*)>/.exec(line);
          from = match ? match[1] : "";
          socket.write("250 2.1.0 ok\r\n");
        } else if (upper.startsWith("RCPT TO")) {
          const match = /<([^>]*)>/.exec(line);
          if (match) to.push(match[1]);
          socket.write("250 2.1.5 ok\r\n");
        } else if (upper === "DATA") {
          inData = true;
          socket.write("354 end with <CRLF>.<CRLF>\r\n");
        } else if (upper === "QUIT") {
          socket.write("221 2.0.0 bye\r\n");
          socket.end();
        } else if (upper.startsWith("RSET") || upper.startsWith("NOOP")) {
          socket.write("250 2.0.0 ok\r\n");
        } else if (upper.startsWith("AUTH")) {
          socket.write("502 5.5.1 auth not supported\r\n");
        } else {
          socket.write("250 2.0.0 ok\r\n");
        }
      }
    });

    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const boundPort = server.address().port;
      resolve({
        messages,
        port: boundPort,
        url: `smtp://${host}:${boundPort}`,
        // 暂时停收：要验证「SMTP 不可用」时断掉监听，之后在同一端口恢复。
        // 直接 close() 共享实例会让同文件后面的用例全红在「没有信」上（S24-13）。
        pause: () =>
          new Promise((done) => {
            for (const socket of sockets) socket.destroy();
            server.close(() => done());
          }),
        resume: () =>
          new Promise((done, failed) => {
            server.once("error", failed);
            server.listen(boundPort, host, () => {
              server.off("error", failed);
              done();
            });
          }),
        close: () =>
          new Promise((done) => {
            for (const socket of sockets) socket.destroy();
            server.close(() => done());
          }),
      });
    });
  });
}

const isMain = process.argv[1] && process.argv[1].endsWith("smtp-sink.mjs");
if (isMain) {
  const index = process.argv.indexOf("--port");
  const port = index >= 0 ? Number(process.argv[index + 1]) || 2525 : 2525;
  startSmtpSink({ port }).then((sink) => {
    console.log(`smtp sink on ${sink.url}`);
    const stop = () => sink.close().then(() => process.exit(0));
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
}
