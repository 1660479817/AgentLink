import { expect, test } from "@playwright/test";

import { ADMIN, uniqueSite, watchErrors } from "./constants.mjs";

const login = async (page) => {
  await page.locator("#username").fill(ADMIN.username);
  await page.locator("#password").fill(ADMIN.password);
  await page.locator('form button[type="submit"]').click();
};

test.describe("审核台", () => {
  test("未登录先看到登录表单，错密码给出提示且不进入控制台", async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto("/admin/");

    await expect(page.locator("#username")).toBeVisible();
    await expect(page.locator("h1")).toContainText("联邦审核台");

    await page.locator("#username").fill(ADMIN.username);
    await page.locator("#password").fill("not-the-password");
    await page.locator('form button[type="submit"]').click();
    await expect(page.locator('p.alert[role="alert"]')).toContainText("账号或密码不对");

    await expect(page.locator("header.top")).toHaveCount(0);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("登录 → 打开待审申请 → 通过 → 生成清单条目 → 退出", async ({ page, request }) => {
    const errors = watchErrors(page);
    const site = uniqueSite("review");

    // 申请走公开接口提交，审核台只负责审核，和线上分工一致。
    const submitted = await request.post("/api/applications", {
      data: { ...site, agree: true, locale: "zh-CN" },
    });
    expect(submitted.status()).toBe(201);
    const { application } = await submitted.json();

    await page.goto("/admin/");
    await login(page);

    await expect(page.locator("header.top")).toBeVisible();
    await expect(page.locator("header.top")).toContainText(ADMIN.username);

    const item = page.locator(".list .item", { hasText: site.name });
    await expect(item).toBeVisible();
    await item.click();

    const detail = page.locator(".detail");
    await expect(detail.locator("h2")).toHaveText(site.name);
    await expect(detail).toContainText(site.url);
    await expect(detail.locator(".badge")).toHaveText("待审");

    await page.locator(".actions button", { hasText: "通过" }).click();
    await expect(detail.locator(".badge")).toHaveText("已通过");

    await page.locator(".snippet button", { hasText: "生成" }).click();
    const pre = page.locator(".snippet pre");
    await expect(pre).toBeVisible();
    const entry = JSON.parse(await pre.innerText());
    expect(entry.url).toBe(site.url);
    expect(entry.id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    expect(entry.status).toBe("active");
    expect(entry.healthUrl).toBeNull();

    await page.locator("header.top button", { hasText: "退出" }).click();
    await expect(page.locator("#username")).toBeVisible();

    // 审核台自己也在 CSP 下运行，全程不能有脚本错误。
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("重复点同一个审核动作，状态不变、列表也不重复", async ({ page, request }) => {
    const site = uniqueSite("idem");
    const submitted = await request.post("/api/applications", {
      data: { ...site, agree: true, locale: "zh-CN" },
    });
    const { application } = await submitted.json();

    await page.goto("/admin/");
    await login(page);

    // 直接按编号定位，避免列表里同名干扰。
    const item = page.locator(".list .item", { hasText: application.id });
    await expect(item).toBeVisible();
    await item.click();
    await page.locator(".actions button", { hasText: "通过" }).click();
    await expect(page.locator(".detail .badge")).toHaveText("已通过");

    await page.locator(".actions button", { hasText: "通过" }).click();
    await expect(page.locator(".detail .badge")).toHaveText("已通过");

    await page.locator("button.tab", { hasText: "已通过" }).click();
    await expect(page.locator(".list .item", { hasText: application.id })).toHaveCount(1);
  });
});
