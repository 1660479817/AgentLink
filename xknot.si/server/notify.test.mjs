import assert from "node:assert/strict";
import test from "node:test";

import {
  ALL_EVENTS,
  INTERNAL_EVENTS,
  PARTNER_EVENTS,
  TEMPLATE_VERSION,
  buildMail,
  buildVars,
  maskEmail,
  normalizeLocale,
  render,
} from "./notify.mjs";

const application = {
  id: "XK-2026-ABC123",
  name: "北港",
  url: "https://nordhavn.example",
  operator: "Lin",
  email: "lin@example.com",
  region: "NO",
  timezone: "Europe/Oslo",
  intro: "北海沿岸的慢阅读与长文笔记。",
  tags: ["长文", "设计"],
  locale: "zh-CN",
  status: "approved",
  tier: "free",
  createdAt: "2026-10-01T00:00:00.000Z",
  reviewedAt: "2026-10-02T00:00:00.000Z",
  stateVersion: 2,
  caseKey: "casekey123",
  mode: "subdomain",
  subdomain: "nordhavn",
  url: "https://nordhavn.xknot.si",
};

const options = {
  origin: "https://xknot.si",
  adminEmail: "ops@xknot.si",
  supportUrl: "https://xknot.si/en/join/",
  replyTo: "no-reply@xknot.si",
  subdomain: "nordhavn.xknot.si",
  entryHost: "entry.xknot.si",
  account: "knot-nordhavn",
  port: "16001",
  links: {
    claimUrl: "https://xknot.si/claim/tok_abcdefgh",
    confirmUrl: "https://xknot.si/case/casekey123",
  },
};

const LOCALES = ["zh-CN", "zh-TW", "en"];

test("registry: 9 partner events and 2 internal events are implemented", () => {
  assert.equal(PARTNER_EVENTS.length, 9);
  assert.equal(INTERNAL_EVENTS.length, 2);
  assert.equal(ALL_EVENTS.length, 11);
  assert.match(TEMPLATE_VERSION, /^\d+\.\d+\.\d+$/);
});

test("registry: there is no waiting, verification or rejection step left", () => {
  for (const legacy of ["partner.received", "partner.verified", "partner.hold", "partner.rejected", "internal.application_verified"]) {
    assert.ok(!ALL_EVENTS.includes(legacy), `${legacy} must be gone`);
  }
  assert.ok(!ALL_EVENTS.includes("partner.pending"));
});

test("registry: every event renders in all three locales without placeholders", () => {
  for (const event of ALL_EVENTS) {
    for (const locale of LOCALES) {
      const mail = buildMail(event, { ...application, locale }, options);
      assert.ok(mail, `${event}/${locale} must render`);
      assert.ok(mail.subject.length > 0 && mail.subject.length < 200, `${event}/${locale} subject`);
      assert.ok(!/\{[a-zA-Z]/.test(mail.subject), `${event}/${locale} subject placeholder`);
      assert.ok(!/\{[a-zA-Z]/.test(mail.text), `${event}/${locale} text placeholder`);
      assert.ok(mail.text.includes(application.id), `${event}/${locale} missing case id`);
      assert.ok(mail.text.length < 8000, `${event}/${locale} too long`);
      assert.equal(mail.templateVersion, TEMPLATE_VERSION);
      assert.equal(mail.locale, locale);
    }
  }
});

test("copy: partner mails are no-reply and say so; internal mail may reply to the applicant", () => {
  for (const event of PARTNER_EVENTS) {
    for (const locale of LOCALES) {
      const mail = buildMail(event, { ...application, locale }, options);
      assert.equal(mail.to, application.email, `${event}/${locale} recipient`);
      assert.equal(mail.replyTo, "no-reply@xknot.si");
      assert.match(mail.text, /不接收回[覆复]|replies are not monitored/, `${event}/${locale} closing`);
    }
  }
  const internal = buildMail("internal.application_new", application, options);
  assert.equal(internal.to, "ops@xknot.si");
  assert.equal(internal.replyTo, application.email);
});

test("copy: no template leaks secrets or internal notes", () => {
  for (const event of ALL_EVENTS) {
    for (const locale of LOCALES) {
      const mail = buildMail(event, { ...application, locale }, options);
      assert.ok(!/xkr_[A-Za-z0-9]|BEGIN OPENSSH PRIVATE KEY|passthrough/i.test(mail.text), `${event}/${locale} secret`);
      assert.ok(!/内部备注|internal note/i.test(mail.text), `${event}/${locale} internal note`);
    }
  }
});

test("copy: the approval mail is also the receipt, and carries no verify link", () => {
  const zh = buildMail("partner.approved", application, options);
  assert.match(zh.text, /自动核对，通过即生效/);
  assert.match(zh.text, /\/case\/casekey123/);
  assert.doesNotMatch(zh.text, /\/verify\//);
  assert.match(zh.text, /免费/);

  const en = buildMail("partner.approved", { ...application, locale: "en" }, options);
  assert.match(en.text, /checks every application as it arrives/);
  assert.match(en.text, /\/case\/casekey123/);
  assert.doesNotMatch(en.text, /\/verify\//);
  assert.match(en.text, /tier: free/);

  const tw = buildMail("partner.approved", { ...application, locale: "zh-TW" }, options);
  assert.match(tw.text, /通過/);
  assert.doesNotMatch(tw.text, /\/verify\//);
});

test("copy: handoff never contains the claim payload", () => {
  const mail = buildMail("partner.handoff", application, options);
  assert.match(mail.text, /\/claim\/tok_abcdefgh/);
  assert.match(mail.text, /72 小时/);
  assert.ok(!/xkr_/.test(mail.text));
});

test("copy: issuance shows tunnel lines, and omits the secret itself", () => {
  const mail = buildMail("partner.issuance", application, options);
  assert.match(mail.text, /nordhavn\.xknot\.si/);
  assert.match(mail.text, /entry\.xknot\.si/);
  assert.match(mail.text, /16001/);
  assert.match(mail.text, /ssh-keygen -t ed25519/);
});

test("vars: the issuance mail derives the subdomain from the application itself", () => {
  // 运营方执行 notify 时不必再手填 --subdomain；申请单里已经有标签。
  const mail = buildMail("partner.issuance", application, { ...options, subdomain: "" });
  assert.match(mail.text, /实例地址：https:\/\/nordhavn\.xknot\.si/);
  assert.doesNotMatch(mail.text, /接入模式/);
  const legacy = buildMail(
    "partner.issuance",
    { ...application, subdomain: null, url: "https://nordhavn.xknot.si" },
    { ...options, subdomain: "" }
  );
  assert.match(legacy.text, /nordhavn\.xknot\.si/);
});

test("vars: missing links become empty, not literal braces", () => {
  const vars = buildVars({ ...application, caseKey: null }, { origin: "https://xknot.si/" });
  assert.equal(vars.origin, "https://xknot.si");
  assert.equal(vars.claimUrl, "");
  const text = render("a {claimUrl} b {unknown}", vars);
  assert.equal(text, "a  b ");
});

test("locale: regional and script variants map to a maintained catalog", () => {
  assert.equal(normalizeLocale("zh-CN"), "zh-CN");
  assert.equal(normalizeLocale("zh-Hans-CN"), "zh-CN");
  assert.equal(normalizeLocale("zh-TW"), "zh-TW");
  assert.equal(normalizeLocale("zh-Hant-HK"), "zh-TW");
  assert.equal(normalizeLocale("en-GB"), "en");
  assert.equal(normalizeLocale(null), "en");
});

test("privacy: contact addresses are masked in revalidation mail", () => {
  assert.equal(maskEmail("lin@example.com"), "l***@example.com");
  assert.equal(maskEmail("no-at-sign"), "no-at-sign");
  const mail = buildMail("partner.contact_revalidate", application, options);
  assert.match(mail.text, /l\*\*\*@example\.com/);
  assert.ok(!mail.text.includes("lin@example.com"));
});

test("registry: an unknown event is a programming error, not a silent no-op", () => {
  assert.throws(() => buildMail("partner.nope", application, options), /unknown_mail_event/);
  assert.throws(() => buildMail("partner.hold", application, options), /unknown_mail_event/);
});
