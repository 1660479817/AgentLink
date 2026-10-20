// 发信：只依赖 Node 自带的 net / tls，不引入 nodemailer。
//
// 中枢只发两类短通知：申请提交给管理员、审核结果给申请人。正文是纯文本，
// UTF-8 一律用 base64，省掉 dot-stuffing 和 8bit 的麻烦。
//
// 环境变量与 Knot 实例保持一致，方便把同一个发信地址抄给伙伴：
//   SMTP_HOST / SMTP_PORT / SMTP_SECURE / SMTP_USER / SMTP_PASS
//   SMTP_FROM / MAIL_FROM
//   XKNOT_ADMIN_EMAIL   管理员收件地址
//   XKNOT_PUBLIC_ORIGIN 邮件里的门户地址，默认 https://xknot.si
//
// 阿里云邮件推送要求 SMTP 认证用户名与发信地址一致；465 端口用隐式 TLS。
// 587 端口若服务器宣告 STARTTLS 则升级，否则默认拒绝明文（测试可用
// SMTP_ALLOW_INSECURE=1 放行）。

import { randomBytes } from "node:crypto";
import net from "node:net";
import tls from "node:tls";

const CRLF = "\r\n";
const DEFAULT_TIMEOUT = 15_000;
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

function truthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function stripNewlines(value) {
  return String(value ?? "").replace(/[\r\n]+/g, " ").trim();
}

function encodeHeader(value) {
  const text = stripNewlines(value);
  if (!/[^\x20-\x7e]/.test(text)) return text;
  return `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;
}

function wrapBase64(value, width = 76) {
  const out = [];
  for (let index = 0; index < value.length; index += width) {
    out.push(value.slice(index, index + width));
  }
  return out.join(CRLF);
}

/**
 * 接受 `a@b.c` 或 `Name <a@b.c>`，拒绝换行与尖括号注入。
 * @returns {{ address: string, name: string, header: string } | null}
 */
export function parseMailbox(value) {
  const raw = stripNewlines(value);
  if (!raw || raw.includes("<") !== raw.includes(">")) return null;
  const match = /^(.*?)\s*<([^<>]+)>$/.exec(raw);
  const address = (match ? match[2] : raw).trim();
  if (!EMAIL_RE.test(address)) return null;
  const name = match ? match[1].trim().replace(/^"|"$/g, "") : "";
  return {
    address,
    name,
    header: name ? `${encodeHeader(name)} <${address}>` : address,
  };
}

const HEADER_NAME_RE = /^[A-Za-z0-9-]{1,40}$/;

// 自定义头只接受 `Name: value`，名字是 ASCII token，值去掉换行；不合法就丢掉。
function sanitizeHeader(header) {
  const raw = typeof header === "string" ? header : "";
  const index = raw.indexOf(":");
  if (index <= 0) return null;
  const name = raw.slice(0, index).trim();
  const value = stripNewlines(raw.slice(index + 1));
  if (!HEADER_NAME_RE.test(name) || !value) return null;
  return `${name}: ${value}`;
}

export function buildMessage({ from, to, subject, text, replyTo, headers = [], date = new Date() }) {
  const sender = parseMailbox(from);
  const recipient = parseMailbox(to);
  if (!sender) throw new Error("invalid_from");
  if (!recipient) throw new Error("invalid_to");

  const lines = [
    `From: ${sender.header}`,
    `To: ${recipient.header}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${date.toUTCString()}`,
    `Message-ID: <${randomBytes(12).toString("hex")}@${sender.address.split("@")[1]}>`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ];

  const reply = replyTo ? parseMailbox(replyTo) : null;
  if (reply) lines.push(`Reply-To: ${reply.header}`);
  for (const header of headers || []) {
    const line = sanitizeHeader(header);
    if (line) lines.push(line);
  }

  return {
    envelopeFrom: sender.address,
    envelopeTo: recipient.address,
    data: `${lines.join(CRLF)}${CRLF}${CRLF}${wrapBase64(Buffer.from(String(text ?? ""), "utf8").toString("base64"))}`,
  };
}

export function mailConfigFromEnv(env = process.env) {
  const host = String(env.SMTP_HOST || "").trim();
  const from = String(env.MAIL_FROM || env.SMTP_FROM || "").trim();
  if (!host || !from) return null;

  const port = Number(env.SMTP_PORT || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;

  return {
    host,
    port,
    secure: truthy(env.SMTP_SECURE),
    allowInsecure: truthy(env.SMTP_ALLOW_INSECURE),
    user: String(env.SMTP_USER || "").trim(),
    pass: String(env.SMTP_PASS || ""),
    from,
    adminEmail: String(env.XKNOT_ADMIN_EMAIL || "").trim(),
    origin: String(env.XKNOT_PUBLIC_ORIGIN || "https://xknot.si").replace(/\/+$/, ""),
  };
}

function waitFor(socket, event) {
  return new Promise((resolve, reject) => {
    const onReady = () => {
      socket.removeListener("error", onError);
      resolve();
    };
    const onError = (error) => {
      socket.removeListener(event, onReady);
      reject(error);
    };
    socket.once(event, onReady);
    socket.once("error", onError);
  });
}

// 一个最小 SMTP 应答读取器：按行收，遇到 `250-` 续行继续等，`250 ` 结束。
function createChannel(socket) {
  let buffer = "";
  let current = null;
  const replies = [];
  let waiter = null;
  let failure = null;

  function settle(reply) {
    if (waiter) {
      const pending = waiter;
      waiter = null;
      pending.resolve(reply);
    } else {
      replies.push(reply);
    }
  }

  function fail(error) {
    if (failure) return;
    failure = error;
    if (waiter) {
      const pending = waiter;
      waiter = null;
      pending.reject(error);
    }
  }

  function onData(chunk) {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf(CRLF)) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const match = /^(\d{3})([ -])(.*)$/.exec(line);
      if (!match) continue;
      const code = Number(match[1]);
      if (!current || current.code !== code) current = { code, lines: [] };
      current.lines.push(match[3]);
      if (match[2] === " ") {
        const reply = current;
        current = null;
        settle(reply);
      }
    }
  }

  function onError(error) {
    fail(error);
  }

  function onClose() {
    fail(new Error("smtp_closed"));
  }

  socket.on("data", onData);
  socket.on("error", onError);
  socket.on("close", onClose);

  return {
    send(line) {
      if (failure) throw failure;
      socket.write(`${line}${CRLF}`);
    },
    next(timeoutMs = DEFAULT_TIMEOUT) {
      if (failure) return Promise.reject(failure);
      if (replies.length) return Promise.resolve(replies.shift());
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiter = null;
          const error = new Error("smtp_timeout");
          fail(error);
          socket.destroy();
          reject(error);
        }, timeoutMs);
        waiter = {
          resolve: (reply) => {
            clearTimeout(timer);
            resolve(reply);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        };
      });
    },
    detach() {
      socket.removeListener("data", onData);
      socket.removeListener("error", onError);
      socket.removeListener("close", onClose);
    },
    close() {
      try {
        socket.end();
      } catch {
        // 已经断了就算了。
      }
    },
  };
}

function replyError(stage, reply) {
  const error = new Error(`smtp_${stage}_${reply.code}`);
  error.code = `smtp_${stage}`;
  error.responseCode = reply.code;
  return error;
}

async function command(channel, line, expected) {
  channel.send(line);
  const reply = await channel.next();
  if (!expected.includes(reply.code)) throw replyError("command", reply);
  return reply;
}

function capabilitiesOf(reply) {
  return reply.lines
    .map((line) => line.trim().toUpperCase())
    .filter((line) => line && line !== "");
}

function authMechanisms(capabilities) {
  for (const line of capabilities) {
    if (line.startsWith("AUTH=")) return line.slice(5).split(/\s+/);
    if (line.startsWith("AUTH ")) return line.slice(5).split(/\s+/);
  }
  return [];
}

async function authenticate(channel, user, pass, capabilities) {
  if (!user) return;
  const mechanisms = authMechanisms(capabilities);

  if (mechanisms.includes("LOGIN")) {
    await command(channel, "AUTH LOGIN", [334]);
    await command(channel, Buffer.from(user, "utf8").toString("base64"), [334]);
    const reply = await command(channel, Buffer.from(pass, "utf8").toString("base64"), [235, 503]);
    if (reply.code === 503) throw replyError("auth", reply);
    return;
  }

  if (mechanisms.includes("PLAIN")) {
    const token = Buffer.from(`\0${user}\0${pass}`, "utf8").toString("base64");
    const reply = await command(channel, `AUTH PLAIN ${token}`, [235, 503]);
    if (reply.code === 503) throw replyError("auth", reply);
    return;
  }

  throw new Error("smtp_auth_unsupported");
}

async function hello(channel, name) {
  const reply = await command(channel, `EHLO ${name}`, [250]);
  return capabilitiesOf(reply);
}

async function upgradeToTls(socket, host) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let secureSocket = null;
    const onError = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    secureSocket = tls.connect(
      {
        socket,
        servername: net.isIP(host) ? undefined : host,
      },
      () => {
        settled = true;
        secureSocket.removeListener("error", onError);
        resolve(secureSocket);
      }
    );
    secureSocket.once("error", onError);
  });
}

async function deliver(config, message) {
  const built = buildMessage({
    from: config.from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    replyTo: message.replyTo,
    headers: message.headers,
  });

  let socket = config.secure
    ? tls.connect({
        host: config.host,
        port: config.port,
        servername: net.isIP(config.host) ? undefined : config.host,
      })
    : net.connect({ host: config.host, port: config.port });
  socket.setNoDelay(true);

  try {
    let channel = createChannel(socket);
    await waitFor(socket, config.secure ? "secureConnect" : "connect");

    const greeting = await channel.next();
    if (greeting.code !== 220) {
      channel.close();
      throw replyError("greeting", greeting);
    }

    const clientName = config.clientName || "xknot.si";
    let capabilities = await hello(channel, clientName);

    if (!config.secure) {
      if (capabilities.includes("STARTTLS")) {
        await command(channel, "STARTTLS", [220]);
        channel.detach();
        socket = await upgradeToTls(socket, config.host);
        // STARTTLS 之后服务器不再发 220 问候，直接 EHLO。
        channel = createChannel(socket);
        capabilities = await hello(channel, clientName);
      } else if (!config.allowInsecure) {
        throw new Error("smtp_tls_required");
      }
    }

    await authenticate(channel, config.user, config.pass, capabilities);

    await command(channel, `MAIL FROM:<${built.envelopeFrom}>`, [250]);
    await command(channel, `RCPT TO:<${built.envelopeTo}>`, [250, 251]);
    await command(channel, "DATA", [354]);

    const payload = built.data.replace(/(^|\r\n)\./g, "$1..");
    channel.send(`${payload}${CRLF}.`);
    const accepted = await channel.next();
    if (accepted.code !== 250) throw replyError("data", accepted);

    try {
      channel.send("QUIT");
      await channel.next(2_000);
    } catch {
      // 信已经收下了，QUIT 失败不影响结果。
    }
    channel.close();
  } catch (error) {
    try {
      socket.destroy();
    } catch {
      // ignore
    }
    throw error;
  }
}

export function createMailer(config) {
  if (!config) return null;
  return {
    from: config.from,
    async send(message) {
      await deliver(config, message);
    },
  };
}

export async function sendMail(config, message) {
  await deliver(config, message);
}
