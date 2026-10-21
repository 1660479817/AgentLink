// 成员入口的登录信。
//
// 它不进 notify.mjs 的事件表：那里是「审核流程对外发什么」，可以由运营台手动重发；
// 登录授权码是事务性的一次性凭据，只该由登录动作本身触发，也不该出现在补发列表里。
//
// 三条硬规则与伙伴信一致：发信人恒为中枢、不接收回复、正文不写内部信息。

const TTL_TEXT = {
  "zh-CN": (minutes) => `${minutes} 分钟`,
  "zh-TW": (minutes) => `${minutes} 分鐘`,
  en: (minutes) => `${minutes} minutes`,
};

const COPY = {
  "zh-CN": {
    subject: "[XKnot] 登录授权码 {code}",
    text: `你在 xknot.si 上用这个邮箱登录。

授权码：{code}

{ttl} 内有效，用一次作废。这封信由系统发出，不接收回复；不是你本人操作可以忽略。

—— XKnot 联邦`,
  },
  "zh-TW": {
    subject: "[XKnot] 登入授權碼 {code}",
    text: `你在 xknot.si 上用這個信箱登入。

授權碼：{code}

{ttl} 內有效，用一次作廢。這封信由系統寄出，不接收回覆；不是你本人操作可以忽略。

—— XKnot 聯邦`,
  },
  en: {
    subject: "[XKnot] Your sign-in code: {code}",
    text: `You asked to sign in at xknot.si with this address.

Sign-in code: {code}

It expires in {ttl} and works once. This mailbox does not accept replies; ignore this message if it was not you.

— XKnot Federation`,
  },
};

function localeOf(value) {
  const locale = String(value || "").trim().toLowerCase();
  if (locale.startsWith("zh-tw") || locale.startsWith("zh-hk") || locale.startsWith("zh-hant")) {
    return "zh-TW";
  }
  if (locale.startsWith("zh")) return "zh-CN";
  return "en";
}

/**
 * @param {{ email: string, code: string, ttlMinutes?: number, locale?: string }} input
 * @returns {{ to: string, subject: string, text: string, locale: string } | null}
 */
export function memberCodeMail({ email, code, ttlMinutes = 10, locale = "zh-CN" } = {}) {
  const to = String(email || "").trim();
  const value = String(code || "").trim();
  if (!to || !/^[0-9]{6}$/.test(value)) return null;

  const lang = localeOf(locale);
  const copy = COPY[lang];
  const ttl = TTL_TEXT[lang](ttlMinutes);
  const fill = (text) => text.replace(/\{code\}/g, value).replace(/\{ttl\}/g, ttl);
  return { to, subject: fill(copy.subject), text: fill(copy.text), locale: lang };
}
