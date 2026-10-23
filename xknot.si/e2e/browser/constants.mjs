import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// 文案从站点自己的 locale 取，改文案时测试跟着变，不在用例里抄一份中文。
export const zhCN = require("../../web/src/locales/zh-CN.json");
export const en = require("../../web/src/locales/en.json");

export const ADMIN = { username: "e2e-admin", password: "e2e-correct-horse-battery" };

/** 每次运行用不同的子域，避免撞上同一小时内的重复申请。 */
export function uniqueSite(tag = "site") {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const subdomain = `${tag}-${stamp}`;
  return {
    name: `端到端 ${stamp}`,
    subdomain,
    url: `https://${subdomain}.xknot.si`,
    operator: "E2E",
    email: "e2e@example.com",
    region: "SG",
    timezone: "Asia/Singapore",
    intro: "浏览器端到端测试提交的站点。",
    tags: "测试, e2e",
  };
}

/**
 * 收集页面上的脚本错误与 CSP 违规；CSP 违规会以 console error 出现。
 *
 * 用例自己主动制造的失败要显式写进 `allow`，不能用一条宽泛的前缀把它连带放过：
 * 只有「这一步失败正是用例要验证的东西」才配放进白名单，且放行它的同时必须有
 * 一条断言看见对应的错误条。默认不过滤任何东西。
 *
 * @param {import("@playwright/test").Page} page
 * @param {{ allow?: RegExp[] }} [options]
 */
export function watchErrors(page, { allow = [] } = {}) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    // 浏览器把资源响应的失败也记成 console error：401/403/404 是接口语义
    // （未登录、无权、不存在），每次登录跳转都会出现，不该算脚本错误。
    // 同一前缀还盖着 5xx、net::ERR_* 和被 CSP 拦掉的脚本：那些必须计入，
    // 否则一次真实的 500 或断链也能让用例全绿（S24-12）。
    if (/^Failed to load resource/.test(text) && /status of (401|403|404)\b/.test(text)) return;
    if (allow.some((pattern) => pattern.test(text))) return;
    errors.push(`console: ${text}`);
  });
  return errors;
}

export async function horizontalOverflow(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });
}
