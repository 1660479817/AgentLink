// 实例委托中枢发信的校验与组装。
//
// 联邦里只有一张已验证的发信地址。实例把它要发的通知交给中枢，由中枢的 SMTP 送出：
// 这是中枢唯一的写入口，但它不写中枢的任何数据，也不留正文（见 docs/FEDERATION.md 第 7 节）。
//
// 这一层只做纯函数：字段校验、回信地址归属、拼装 mailer 认识的消息。发不发、记什么
// 由 app.mjs 决定。

import { parseMailbox } from "./mail.mjs";

export const RELAY_LIMITS = {
  to: 254,
  subject: 120,
  text: 4000,
  replyTo: 254,
  idempotencyKey: 64,
  perMinute: 6,
  perHour: 240,
};

// 只收裸地址：带显示名就可能有歧义，也省掉一条注入面。
const ADDRESS_RE = /^[^\s@<>",;:\\]+@[^\s@<>",;:\\]+\.[^\s@<>",;:\\]+$/;
const IDEM_RE = /^[A-Za-z0-9._:-]{1,64}$/;

export function isPlainAddress(value) {
  if (typeof value !== "string") return false;
  const address = value.trim();
  if (!address || address.length > RELAY_LIMITS.to) return false;
  return ADDRESS_RE.test(address);
}

function hostOf(address) {
  const index = String(address).lastIndexOf("@");
  return index < 0 ? "" : String(address).slice(index + 1).toLowerCase();
}

function emailOf(value) {
  if (typeof value !== "string") return null;
  const parsed = parseMailbox(value);
  return parsed && !value.includes("<") ? parsed.address : null;
}

/** 实例自己的回信域名：清单 url 与 contact 里的邮箱。 */
export function instanceReplyDomains(instance) {
  const hosts = new Set();
  for (const raw of [instance?.url]) {
    try {
      const url = new URL(String(raw || ""));
      if (url.protocol === "https:" && url.hostname) hosts.add(url.hostname.toLowerCase());
    } catch {
      // 清单已经校验过 https，这里只是容错。
    }
  }
  const contact = emailOf(instance?.contact);
  if (contact) hosts.add(hostOf(contact));
  return hosts;
}

export function isAllowedReplyTo(address, instance) {
  const host = hostOf(address);
  if (!host) return false;
  for (const allowed of instanceReplyDomains(instance)) {
    if (host === allowed || host.endsWith(`.${allowed}`)) return true;
  }
  return false;
}

/**
 * 校验一封委托信。字段错误按字段返回，和加入申请的错误码风格一致。
 * @returns {{ ok: boolean, value?: object, errors?: Record<string, string> }}
 */
export function validateRelayRequest(payload, { instance, from } = {}) {
  const errors = {};
  const body = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};

  const to = typeof body.to === "string" ? body.to.trim() : "";
  if (!to) errors.to = "required";
  else if (!isPlainAddress(to)) errors.to = "invalid_address";
  else {
    const sender = parseMailbox(from || "");
    if (sender && sender.address.toLowerCase() === to.toLowerCase()) errors.to = "self_address";
  }

  const subject = typeof body.subject === "string" ? body.subject : "";
  if (!subject.trim()) errors.subject = "required";
  else if (/[\r\n]/.test(subject)) errors.subject = "newline";
  else if ([...subject].length > RELAY_LIMITS.subject) errors.subject = "too_long";

  const text = typeof body.text === "string" ? body.text : "";
  if (!text.trim()) errors.text = "required";
  else if (/[\u0000\r]/.test(text)) errors.text = "control_character";
  else if ([...text].length > RELAY_LIMITS.text) errors.text = "too_long";

  let replyTo = null;
  if (body.replyTo != null && body.replyTo !== "") {
    const candidate = typeof body.replyTo === "string" ? body.replyTo.trim() : "";
    if (!isPlainAddress(candidate)) errors.replyTo = "invalid_address";
    else if (!isAllowedReplyTo(candidate, instance)) errors.replyTo = "foreign_domain";
    else replyTo = candidate;
  } else {
    // 不指定就回到实例的公开联系邮箱；没有就留空，让收件人回给发信地址。
    const contact = emailOf(instance?.contact);
    replyTo = contact || null;
  }

  let idempotencyKey = null;
  if (body.idempotencyKey != null && body.idempotencyKey !== "") {
    const candidate = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
    if (!IDEM_RE.test(candidate)) errors.idempotencyKey = "invalid";
    else idempotencyKey = candidate;
  }

  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    value: { to, subject, text, replyTo, idempotencyKey },
  };
}

/** 组装成 mail.mjs 认识的消息；发信人恒为中枢，实例只体现在自定义头上。 */
export function relayMessage(value, { instance } = {}) {
  return {
    to: value.to,
    subject: value.subject,
    text: value.text,
    replyTo: value.replyTo || undefined,
    headers: [`X-XKnot-Instance: ${instance?.id || "unknown"}`],
  };
}

export function domainOf(address) {
  return hostOf(address);
}
