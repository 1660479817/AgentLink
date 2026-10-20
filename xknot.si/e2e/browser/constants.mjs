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
    requestAccess: "direct",
    operator: "E2E",
    email: "e2e@example.com",
    region: "SG",
    timezone: "Asia/Singapore",
    intro: "浏览器端到端测试提交的站点。",
    tags: "测试, e2e",
  };
}

/** 收集页面上的脚本错误与 CSP 违规；CSP 违规会以 console error 出现。 */
export function watchErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    // 浏览器会把 401/404 这类资源响应也记成 console error，那是接口语义，
    // 不是脚本错误；这里只看真正的异常与 CSP 拒绝。
    if (text.startsWith("Failed to load resource")) return;
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
