// 伙伴侧页面：邮箱验证、申请案例页、一次性领取页。
//
// 三个页面都遵守同一条规则：GET 只渲染「确认」按钮，消费令牌必须是 POST。
// 邮箱安全网关会预取链接，GET 一消费就等于替用户点掉了。
//
// 没有构建步骤、没有前端脚本：只发内联样式的 HTML 和普通表单。
// 所有用户数据都经过 escapeHtml，申请内容不会当 HTML 执行。

import { ACCESS_LABEL, normalizeLocale } from "./notify.mjs";

const PAGE_STYLE = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #F0F2F5; color: #050505;
         font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", sans-serif; }
  main { max-width: 40rem; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; }
  .card { background: #fff; border-radius: 8px; padding: 1.75rem; box-shadow: 0 1px 2px rgba(0,0,0,.08); }
  h1 { margin: 0 0 .5rem; font-size: 1.375rem; line-height: 1.35; }
  p { margin: 0 0 .85rem; }
  .muted { color: #65676B; font-size: .9rem; }
  dl { display: grid; grid-template-columns: 7.5rem 1fr; gap: .35rem .75rem; margin: 1.25rem 0; }
  dt { color: #65676B; }
  dd { margin: 0; word-break: break-word; }
  .button, button { appearance: none; border: 0; border-radius: 6px; background: #0866FF; color: #fff;
    font: inherit; font-weight: 600; padding: .7rem 1.25rem; min-height: 44px; cursor: pointer; }
  .button:hover, button:hover { background: #0056d6; }
  .secondary { background: #E4E6EB; color: #050505; }
  .secondary:hover { background: #D8DADF; }
  form { margin: 0; display: inline-block; }
  .actions { display: flex; flex-wrap: wrap; gap: .6rem; margin-top: 1.25rem; }
  textarea { width: 100%; min-height: 7rem; font: .9rem/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
    padding: .6rem; border: 1px solid #CED0D4; border-radius: 6px; }
  pre { background: #F0F2F5; border-radius: 6px; padding: 1rem; overflow-x: auto;
        font: .85rem/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; word-break: break-all; }
  .banner { border-radius: 6px; padding: .85rem 1rem; margin-bottom: 1.25rem; background: #FFF4E5; color: #6b4700; }
  .banner.ok { background: #E7F5EA; color: #14532d; }
  .banner.bad { background: #FDECEC; color: #7f1d1d; }
  .items { margin: .35rem 0 1rem; padding-left: 1.2rem; }
  footer { margin-top: 2rem; color: #65676B; font-size: .8rem; }
`;

const TEXT = {
  "zh-CN": {
    verifyTitle: "确认邮箱 · XKnot 联邦",
    verifyHeading: "确认你的邮箱",
    verifyBody: "点下面的按钮完成确认。确认后申请进入人工审核。",
    verifyButton: "确认邮箱",
    verifyExpired: "这个链接已经过期。请在申请页重新发送验证信。",
    verifyUsed: "这个链接已经用过了。如果已经确认过，不必重复操作。",
    verifyMissing: "这个链接无效。请从最近一封验证信里打开，或到申请页重新发送。",
    verifyClosed: "这个申请已经结束，无法再确认邮箱。",
    verifyDone: "邮箱已确认。申请已进入人工审核，通常 3 个工作日内给出结果。",
    verifyDoneAgain: "这个邮箱之前已经确认过了，申请正在审核中。",
    caseTitle: "申请状态 · XKnot 联邦",
    caseHeading: "申请 {id}",
    caseResend: "重新发送验证信",
    caseResent: "验证信已重新发送，请查看邮箱。",
    caseWithdraw: "撤回这份申请",
    caseWithdrawn: "申请已撤回。",
    casePublicKey: "提交公钥",
    casePublicKeyHint: "只粘贴 .pub 的内容。私钥留在你自己的机器上。",
    casePublicKeySaved: "公钥已保存。",
    caseConfirm: "确认联系人仍然有效",
    caseConfirmed: "联系人已确认。",
    caseClosed: "这份申请已经结束，只能查看，不能再操作。",
    caseFooter: "本页面只对持有链接的人可见，不要转发。",
    claimTitle: "领取接入资料 · XKnot 联邦",
    claimHeading: "领取接入资料",
    claimBody: "点下面的按钮显示一次。内容包含凭据，请立即写进实例配置，不要转发或截图。",
    claimButton: "显示接入资料",
    claimUsed: "这份资料已经被领取过。需要重新签发请联系运营方。",
    claimExpired: "这个领取链接已过期。请联系运营方重新签发。",
    claimMissing: "这个链接无效。",
    claimWarning: "关闭本页后不会再显示。",
    status: "状态",
    site: "站点",
    url: "地址",
    access: "落点",
    submitted: "提交时间",
    holdItems: "需要补充",
    reason: "原因",
    close: "关闭",
    footer: "—— XKnot 联邦",
  },
  "zh-TW": {
    verifyTitle: "確認信箱 · XKnot 聯邦",
    verifyHeading: "確認你的信箱",
    verifyBody: "點下面的按鈕完成確認。確認後申請進入人工審核。",
    verifyButton: "確認信箱",
    verifyExpired: "這個連結已經過期。請在申請頁重新傳送驗證信。",
    verifyUsed: "這個連結已經用過了。如果已經確認過，不必重複操作。",
    verifyMissing: "這個連結無效。請從最近一封驗證信裡開啟，或到申請頁重新傳送。",
    verifyClosed: "這個申請已經結束，無法再確認信箱。",
    verifyDone: "信箱已確認。申請已進入人工審核，通常 3 個工作日內給出結果。",
    verifyDoneAgain: "這個信箱之前已經確認過了，申請正在審核中。",
    caseTitle: "申請狀態 · XKnot 聯邦",
    caseHeading: "申請 {id}",
    caseResend: "重新傳送驗證信",
    caseResent: "驗證信已重新傳送，請查看信箱。",
    caseWithdraw: "撤回這份申請",
    caseWithdrawn: "申請已撤回。",
    casePublicKey: "提交公鑰",
    casePublicKeyHint: "只貼上 .pub 的內容。私鑰留在你自己的機器上。",
    casePublicKeySaved: "公鑰已儲存。",
    caseConfirm: "確認聯絡人仍然有效",
    caseConfirmed: "聯絡人已確認。",
    caseClosed: "這份申請已經結束，只能查看，不能再操作。",
    caseFooter: "本頁面只對持有連結的人可見，不要轉發。",
    claimTitle: "領取接入資料 · XKnot 聯邦",
    claimHeading: "領取接入資料",
    claimBody: "點下面的按鈕顯示一次。內容包含憑證，請立即寫進實例設定，不要轉發或截圖。",
    claimButton: "顯示接入資料",
    claimUsed: "這份資料已經被領取過。需要重新簽發請聯絡營運方。",
    claimExpired: "這個領取連結已過期。請聯絡營運方重新簽發。",
    claimMissing: "這個連結無效。",
    claimWarning: "關閉本頁後不會再顯示。",
    status: "狀態",
    site: "站點",
    url: "位址",
    access: "落點",
    submitted: "提交時間",
    holdItems: "需要補充",
    reason: "原因",
    close: "關閉",
    footer: "—— XKnot 聯邦",
  },
  en: {
    verifyTitle: "Confirm email · XKnot Federation",
    verifyHeading: "Confirm your email",
    verifyBody: "Use the button below to confirm. The application then enters manual review.",
    verifyButton: "Confirm email",
    verifyExpired: "This link has expired. Send a new verification message from the application page.",
    verifyUsed: "This link was already used. If you confirmed earlier, nothing else is needed.",
    verifyMissing: "This link is not valid. Open the latest verification message, or resend from the application page.",
    verifyClosed: "This application is closed, so the email can no longer be confirmed.",
    verifyDone: "Email confirmed. The application is now under manual review; we usually reply within 3 business days.",
    verifyDoneAgain: "This email was already confirmed and the application is under review.",
    caseTitle: "Application status · XKnot Federation",
    caseHeading: "Application {id}",
    caseResend: "Resend verification message",
    caseResent: "Verification message sent again; please check your inbox.",
    caseWithdraw: "Withdraw this application",
    caseWithdrawn: "Application withdrawn.",
    casePublicKey: "Submit public key",
    casePublicKeyHint: "Paste only the .pub content. Keep the private key on your own machine.",
    casePublicKeySaved: "Public key saved.",
    caseConfirm: "Confirm the contact is still valid",
    caseConfirmed: "Contact confirmed.",
    caseClosed: "This application is closed. It can be viewed but no longer changed.",
    caseFooter: "This page is visible only to whoever holds the link. Do not forward it.",
    claimTitle: "Claim access material · XKnot Federation",
    claimHeading: "Claim access material",
    claimBody: "The button below reveals the material once. It contains credentials; write it into the instance configuration immediately and do not forward or screenshot it.",
    claimButton: "Reveal access material",
    claimUsed: "This material was already claimed. Ask the operator to issue it again.",
    claimExpired: "This claim link has expired. Ask the operator to issue it again.",
    claimMissing: "This link is not valid.",
    claimWarning: "It will not be shown again after you close this page.",
    status: "Status",
    site: "Site",
    url: "URL",
    access: "Landing",
    submitted: "Submitted",
    holdItems: "Still needed",
    reason: "Reason",
    close: "Close",
    footer: "— XKnot Federation",
  },
};

const STATUS_LABEL = {
  pending: { "zh-CN": "等待邮箱确认", "zh-TW": "等待信箱確認", en: "waiting for email confirmation" },
  verified: { "zh-CN": "等待人工审核", "zh-TW": "等待人工審核", en: "waiting for manual review" },
  hold: { "zh-CN": "需要补充材料", "zh-TW": "需要補充材料", en: "needs more information" },
  approved: { "zh-CN": "已通过收录审核", "zh-TW": "已通過收錄審核", en: "approved for listing" },
  rejected: { "zh-CN": "本次未通过", "zh-TW": "本次未通過", en: "not approved this time" },
  withdrawn: { "zh-CN": "已撤回", "zh-TW": "已撤回", en: "withdrawn" },
  expired: { "zh-CN": "已过期", "zh-TW": "已過期", en: "expired" },
};

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function t(locale, key) {
  const table = TEXT[normalizeLocale(locale)] || TEXT.en;
  return table[key] ?? TEXT.en[key] ?? key;
}

function statusLabel(status, locale) {
  const entry = STATUS_LABEL[status] || STATUS_LABEL.pending;
  return entry[normalizeLocale(locale)] || entry.en;
}

function pickAccess(value, locale) {
  const entry = ACCESS_LABEL[value] || ACCESS_LABEL.unknown;
  return entry[normalizeLocale(locale)] || entry.en;
}

function shell(locale, title, body) {
  return `<!doctype html>
<html lang="${escapeHtml(normalizeLocale(locale))}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)}</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<main>
${body}
<footer>${escapeHtml(t(locale, "footer"))}</footer>
</main>
</body>
</html>`;
}

function banner(kind, text) {
  return `<p class="banner${kind ? ` ${kind}` : ""}">${escapeHtml(text)}</p>`;
}

/**
 * 邮箱验证页：只有按钮，令牌放在隐藏字段里。
 */
export function renderVerifyPage(token, locale) {
  const body = `<section class="card">
  <h1>${escapeHtml(t(locale, "verifyHeading"))}</h1>
  <p>${escapeHtml(t(locale, "verifyBody"))}</p>
  <form method="post" action="/api/verify">
    <input type="hidden" name="token" value="${escapeHtml(token)}">
    <button type="submit">${escapeHtml(t(locale, "verifyButton"))}</button>
  </form>
</section>`;
  return shell(locale, t(locale, "verifyTitle"), body);
}

export function renderVerifyResult(outcome, application, locale) {
  const localeOfApplication = normalizeLocale(application?.locale || locale);
  const message = {
    ok: t(localeOfApplication, "verifyDone"),
    already: t(localeOfApplication, "verifyDoneAgain"),
    expired: t(localeOfApplication, "verifyExpired"),
    used: t(localeOfApplication, "verifyUsed"),
    missing: t(localeOfApplication, "verifyMissing"),
    closed: t(localeOfApplication, "verifyClosed"),
  }[outcome] || t(localeOfApplication, "verifyMissing");
  const kind = outcome === "ok" || outcome === "already" ? "ok" : "bad";
  const caseUrl = application?.caseKey ? `/case/${escapeHtml(application.caseKey)}` : "";
  const body = `<section class="card">
  <h1>${escapeHtml(t(localeOfApplication, "verifyHeading"))}</h1>
  ${banner(kind, message)}
  ${caseUrl ? `<p class="actions"><a class="button secondary" href="${caseUrl}">${escapeHtml(t(localeOfApplication, "status"))}</a></p>` : ""}
</section>`;
  return shell(localeOfApplication, t(localeOfApplication, "verifyTitle"), body);
}

/**
 * 案例页：状态、补材料清单、以及当前状态下允许的动作。
 * 已结案的申请只读。
 */
export function renderCasePage(application, options = {}) {
  if (!application) {
    return shell("en", "Application", `<section class="card">${banner("bad", "This link is not valid.")}</section>`);
  }
  const locale = normalizeLocale(application.locale);
  const status = application.status;
  const open = !["approved", "rejected", "withdrawn", "expired"].includes(status);
  const key = encodeURIComponent(application.caseKey || "");

  const rows = [
    [t(locale, "status"), statusLabel(status, locale)],
    [t(locale, "site"), application.name],
    [t(locale, "url"), application.url],
    [t(locale, "access"), pickAccess(application.requestAccess, locale)],
    [t(locale, "submitted"), String(application.createdAt || "").slice(0, 10)],
  ];
  if (status === "rejected" && application.rejectReason) {
    rows.push([t(locale, "reason"), application.rejectReason]);
  }

  const notices = [];
  if (options.resend === "sent") notices.push(banner("ok", t(locale, "caseResent")));
  if (options.withdrawn === 1) notices.push(banner("ok", t(locale, "caseWithdrawn")));
  if (options.publicKey === "saved") notices.push(banner("ok", t(locale, "casePublicKeySaved")));
  if (options.contact === "confirmed") notices.push(banner("ok", t(locale, "caseConfirmed")));

  const hold = status === "hold" && Array.isArray(application.holdItems) && application.holdItems.length
    ? `<p>${escapeHtml(t(locale, "holdItems"))}</p><ul class="items">${application.holdItems
        .map((code) => `<li>${escapeHtml(code)}</li>`)
        .join("")}</ul>`
    : "";

  const actions = [];
  if (open) {
    actions.push(`<form method="post" action="/api/case/${key}/resend-verify"><button class="secondary" type="submit">${escapeHtml(
      t(locale, "caseResend")
    )}</button></form>`);
    actions.push(`<form method="post" action="/api/case/${key}/withdraw"><button class="secondary" type="submit">${escapeHtml(
      t(locale, "caseWithdraw")
    )}</button></form>`);
  }

  // 归属验证已取消：申请时站点还不存在，子域由中枢签发。
  // 案例页只留公钥与联系人两件事。
  const caseForms = open
    ? `<h2>${escapeHtml(t(locale, "casePublicKey"))}</h2>
<p class="muted">${escapeHtml(t(locale, "casePublicKeyHint"))}</p>
<form method="post" action="/api/case/${key}/public-key">
  <textarea name="publicKey" spellcheck="false" autocomplete="off" placeholder="ssh-ed25519 AAAA..."></textarea>
  <p class="actions"><button type="submit">${escapeHtml(t(locale, "casePublicKey"))}</button></p>
</form>
<form method="post" action="/api/case/${key}/confirm-contact">
  <p class="actions"><button class="secondary" type="submit">${escapeHtml(t(locale, "caseConfirm"))}</button></p>
</form>`
    : `<p class="muted">${escapeHtml(t(locale, "caseClosed"))}</p>`;

  const body = `<section class="card">
  <h1>${escapeHtml(t(locale, "caseHeading").replace("{id}", application.id))}</h1>
  ${notices.join("")}
  ${hold}
  <dl>${rows
    .map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`)
    .join("")}</dl>
  ${actions.length ? `<div class="actions">${actions.join("")}</div>` : ""}
  ${caseForms}
  <p class="muted" style="margin-top:1.5rem">${escapeHtml(t(locale, "caseFooter"))}</p>
</section>`;
  return shell(locale, t(locale, "caseTitle"), body);
}

export function renderClaimPage(token, application, locale) {
  const useLocale = normalizeLocale(application?.locale || locale);
  const body = `<section class="card">
  <h1>${escapeHtml(t(useLocale, "claimHeading"))}</h1>
  <p>${escapeHtml(t(useLocale, "claimBody"))}</p>
  <form method="post" action="/api/claim">
    <input type="hidden" name="token" value="${escapeHtml(token)}">
    <button type="submit">${escapeHtml(t(useLocale, "claimButton"))}</button>
  </form>
  <p class="muted">${escapeHtml(t(useLocale, "claimWarning"))}</p>
</section>`;
  return shell(useLocale, t(useLocale, "claimTitle"), body);
}

export function renderClaimResult(outcome, payload, locale) {
  const useLocale = normalizeLocale(locale);
  if (outcome !== "ok") {
    const message = {
      used: t(useLocale, "claimUsed"),
      expired: t(useLocale, "claimExpired"),
      missing: t(useLocale, "claimMissing"),
    }[outcome] || t(useLocale, "claimMissing");
    return shell(
      useLocale,
      t(useLocale, "claimTitle"),
      `<section class="card"><h1>${escapeHtml(t(useLocale, "claimHeading"))}</h1>${banner(
        "bad",
        message
      )}</section>`
    );
  }
  const body = `<section class="card">
  <h1>${escapeHtml(t(useLocale, "claimHeading"))}</h1>
  ${banner("ok", t(useLocale, "claimWarning"))}
  <pre>${escapeHtml(payload)}</pre>
</section>`;
  return shell(useLocale, t(useLocale, "claimTitle"), body);
}
