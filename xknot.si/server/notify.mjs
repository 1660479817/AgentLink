// 申请与审核的通知信。
//
// 这里只组装收件人、主题和纯文本正文；怎么寄出去由 mail.mjs 负责。
// 审核备注是内部字段，任何一封给申请人的信里都不出现。

function normalizeLocale(value) {
  const locale = String(value || "").trim().toLowerCase();
  if (locale.startsWith("zh-tw") || locale.startsWith("zh-hk") || locale.startsWith("zh-hant")) {
    return "zh-TW";
  }
  if (locale.startsWith("zh")) return "zh-CN";
  return "en";
}

export function newApplicationMail(application, { adminEmail, origin }) {
  if (!adminEmail) return null;
  const subject = `[xknot] 新加入申请 ${application.id} · ${application.name}`;
  const text = [
    "有一条新的加入申请，等待审核。",
    "",
    `编号：${application.id}`,
    `站点：${application.name}`,
    `地址：${application.url}`,
    `运营者：${application.operator}`,
    `联系邮箱：${application.email}`,
    `区域 / 时区：${application.region} / ${application.timezone}`,
    `简介：${application.intro}`,
    `标签：${application.tags.length ? application.tags.join(", ") : "—"}`,
    `提交时间：${application.createdAt}`,
    "",
    `审核台：${origin}/admin/`,
  ].join("\n");

  return {
    to: adminEmail,
    replyTo: application.email,
    subject,
    text,
  };
}

const COPY = {
  "zh-CN": {
    approved: {
      subject: (application) => `Knot 联邦加入申请已通过 · ${application.name}`,
      body: (application, origin) =>
        [
          `你好，${application.operator}：`,
          "",
          `你提交的 Knot 联邦加入申请（${application.id}）已通过审核。`,
          "",
          `站点：${application.name}`,
          `地址：${application.url}`,
          "",
          "下一步，我们会把站点写进联邦清单并重新构建门户。收录不会自动上线，也不会替你改 DNS、签发子域或开隧道；这些需要时另行联系。",
          "",
          `联邦入口：${origin}`,
          "",
          "—— Knot 联邦",
        ].join("\n"),
    },
    rejected: {
      subject: (application) => `Knot 联邦加入申请结果 · ${application.name}`,
      body: (application, origin) =>
        [
          `你好，${application.operator}：`,
          "",
          `你提交的 Knot 联邦加入申请（${application.id}）本次未通过审核。`,
          "",
          `站点：${application.name}`,
          `地址：${application.url}`,
          "",
          `如果情况有变化，可以修改后重新提交；有疑问直接回复本邮件。联邦入口：${origin}`,
          "",
          "—— Knot 联邦",
        ].join("\n"),
    },
  },
  "zh-TW": {
    approved: {
      subject: (application) => `Knot 聯邦加入申請已通過 · ${application.name}`,
      body: (application, origin) =>
        [
          `你好，${application.operator}：`,
          "",
          `你提交的 Knot 聯邦加入申請（${application.id}）已通過審核。`,
          "",
          `站點：${application.name}`,
          `位址：${application.url}`,
          "",
          "下一步，我們會把站點寫進聯邦清單並重新建置入口。收錄不會自動上線，也不會替你改 DNS、簽發子網域或開隧道；這些需要時另行聯絡。",
          "",
          `聯邦入口：${origin}`,
          "",
          "—— Knot 聯邦",
        ].join("\n"),
    },
    rejected: {
      subject: (application) => `Knot 聯邦加入申請結果 · ${application.name}`,
      body: (application, origin) =>
        [
          `你好，${application.operator}：`,
          "",
          `你提交的 Knot 聯邦加入申請（${application.id}）本次未通過審核。`,
          "",
          `站點：${application.name}`,
          `位址：${application.url}`,
          "",
          `如果情況有變化，可以修改後重新提交；有疑問直接回覆本郵件。聯邦入口：${origin}`,
          "",
          "—— Knot 聯邦",
        ].join("\n"),
    },
  },
  en: {
    approved: {
      subject: (application) => `Your Knot Federation application was approved · ${application.name}`,
      body: (application, origin) =>
        [
          `Hello ${application.operator},`,
          "",
          `Your application to join the Knot Federation (${application.id}) has been approved.`,
          "",
          `Site: ${application.name}`,
          `URL: ${application.url}`,
          "",
          "Next, we will add the site to the federation manifest and rebuild the portal. Admission does not publish automatically, and it does not change your DNS, issue a subdomain, or open a tunnel. Contact us separately if you need those.",
          "",
          `Federation: ${origin}`,
          "",
          "— Knot Federation",
        ].join("\n"),
    },
    rejected: {
      subject: (application) => `Your Knot Federation application · ${application.name}`,
      body: (application, origin) =>
        [
          `Hello ${application.operator},`,
          "",
          `Your application to join the Knot Federation (${application.id}) was not approved this time.`,
          "",
          `Site: ${application.name}`,
          `URL: ${application.url}`,
          "",
          `You can revise and submit again if things change. Reply to this message if you have questions. Federation: ${origin}`,
          "",
          "— Knot Federation",
        ].join("\n"),
    },
  },
};

// approved / rejected 才发；hold 是内部状态，rejected 不附内部备注。
export function applicantReviewMail(application, decision, { adminEmail, origin }) {
  if (!application?.email) return null;
  if (decision !== "approved" && decision !== "rejected") return null;

  const locale = normalizeLocale(application.locale);
  const copy = COPY[locale][decision];
  return {
    to: application.email,
    replyTo: adminEmail || undefined,
    subject: copy.subject(application),
    text: copy.body(application, origin),
  };
}

export { normalizeLocale };
