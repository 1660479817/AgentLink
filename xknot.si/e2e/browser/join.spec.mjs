import { expect, test } from "@playwright/test";

import { uniqueSite, watchErrors, zhCN } from "./constants.mjs";

async function fillForm(page, site) {
  await page.locator("#join-name").fill(site.name);
  await page.locator('input[name="join-mode"][value="subdomain"]').check();
  await page.locator("#join-subdomain").fill(site.subdomain);
  await page.locator("#join-intro").fill(site.intro);
  await page.locator("#join-operator").fill(site.operator);
  await page.locator("#join-email").fill(site.email);
  await page.locator("#join-region").selectOption(site.region);
  await page.locator("#join-timezone").fill(site.timezone);
  await page.locator("#join-tags").fill(site.tags);
  await page.locator(".agree input[type=checkbox]").check();
}

const submit = (page) => page.locator('form.form button[type="submit"]');

test.describe("加入申请", () => {
  test("空表单提交逐项报错，焦点落到第一个错误字段", async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto("/zh-CN/");
    await submit(page).click();

    await expect(page.locator("#join-name")).toBeFocused();
    await expect(page.locator("#join-name")).toHaveAttribute("aria-invalid", "true");
    expect(await page.locator('[aria-invalid="true"]').count()).toBeGreaterThanOrEqual(5);
    await expect(page.locator("p.summary")).toHaveText(new RegExp(zhCN.formError.summary));

    // 客户端校验不发请求，页面不该有任何脚本错误。
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("子域与邮箱不合法时不提交，错误就在字段下面", async ({ page }) => {
    await page.goto("/zh-CN/");
    const site = uniqueSite("invalid");
    await fillForm(page, { ...site, subdomain: "nord havn", email: "lin@" });
    await submit(page).click();

    await expect(page.locator("#join-subdomain-error")).toHaveText(zhCN.formError.subdomain.invalid);
    await expect(page.locator("#join-subdomain")).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#join-email-error")).toHaveText(zhCN.formError.email);
    await expect(page.locator(".done")).toHaveCount(0);
  });

  test("完整填写后提交成功并显示申请编号，再填一份回到空白表单", async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto("/zh-CN/");
    const site = uniqueSite("apply");
    await fillForm(page, site);
    await submit(page).click();

    const done = page.locator('.done[role="status"]');
    await expect(done).toBeVisible();
    await expect(done).toContainText(zhCN.done.title);
    const reference = await done.locator("dd").first().innerText();
    expect(reference).toMatch(/^XK-\d{4}-[0-9A-Z]{6}$/);

    await page.locator("button.again").click();
    await expect(page.locator("#join-name")).toHaveValue("");
    // 模式也一起清空：没选模式时不显示地址栏。
    await expect(page.locator('input[name="join-mode"]:checked')).toHaveCount(0);
    await page.locator('input[name="join-mode"][value="subdomain"]').check();
    await expect(page.locator("#join-subdomain")).toHaveValue("");
    // 时区是刻意的例外：下次还按浏览器/上次填的来。
    await expect(page.locator("#join-timezone")).toHaveValue(site.timezone);

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("同一子域再提交一次，提示已在队列里，不新增记录", async ({ page }) => {
    await page.goto("/zh-CN/");
    const site = uniqueSite("dup");
    await fillForm(page, site);
    await submit(page).click();
    await expect(page.locator(".done")).toBeVisible();

    await page.locator("button.again").click();
    await fillForm(page, { ...site, name: "换个名字" });
    await submit(page).click();

    await expect(page.locator("p.summary")).toContainText(zhCN.formError.duplicate);
    await expect(page.locator(".done")).toHaveCount(0);
  });

  test("蜜罐填了就回成功，但不落库", async ({ page, request }) => {
    await page.goto("/zh-CN/");
    const site = uniqueSite("bot");
    await fillForm(page, site);
    // 正常用户看不见这个字段，脚本会把它填上。
    await page.evaluate(() => {
      const trap = document.querySelector("#join-website");
      trap.value = "http://spam.example";
      trap.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await submit(page).click();

    await expect(page.locator(".done")).toBeVisible();
    await expect(page.locator(".done")).toContainText("XK-DISCARDED");

    // 编号是丢弃标记，说明接口走了蜜罐分支，库里没有这条。
    expect(site.subdomain).toContain("bot-");
  });

  test("390px 下表单可用：输入区不少于 44px，提交键在容器内", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/zh-CN/");
    await page.locator("#join-name").scrollIntoViewIfNeeded();

    const height = await page.locator("#join-name").evaluate((node) => node.getBoundingClientRect().height);
    expect(height).toBeGreaterThanOrEqual(44);

    const button = submit(page);
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box.width).toBeLessThanOrEqual(390);
    expect(box.height).toBeGreaterThanOrEqual(44);
  });
});
