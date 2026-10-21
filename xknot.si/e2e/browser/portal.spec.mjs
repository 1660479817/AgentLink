import { expect, test } from "@playwright/test";

import { en, horizontalOverflow, watchErrors, zhCN } from "./constants.mjs";

async function hubData(request) {
  const response = await request.get("/data/hub.json");
  expect(response.ok()).toBeTruthy();
  return response.json();
}

test.describe("门户", () => {
  test("按 hub.json 渲染全部实例，脚本与 CSP 无报错", async ({ page, request }) => {
    const errors = watchErrors(page);
    await page.goto("/en/");

    const data = await hubData(request);
    await expect(page.locator("h1#net-title")).toBeVisible();
    await expect(page.locator("#nodes article.card")).toHaveCount(data.instances.length);
    await expect(page.locator(".map svg").first()).toBeVisible();

    // 每张卡片的名称都回到自己的站点，且不带 opener。
    const links = page.locator("#nodes article.card a.name");
    await expect(links).toHaveCount(data.instances.length);
    for (const link of await links.all()) {
      await expect(link).toHaveAttribute("href", /^https:\/\//);
      await expect(link).toHaveAttribute("rel", /noopener/);
    }

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("三个语种入口互相可达，当前语种有 aria-current", async ({ page }) => {
    await page.goto("/en/");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("h1#net-title")).toContainText(en.hero.name);

    const current = page.locator('a[hreflang="en"][aria-current="page"]:visible').first();
    await expect(current).toBeVisible();

    await page.locator('a[hreflang="zh-CN"]:visible').first().click();
    await expect(page).toHaveURL(/\/zh-CN\/$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(page.locator("h2#directory-title")).toContainText(zhCN.nodes.label);

    await page.locator('a[hreflang="zh-TW"]:visible').first().click();
    await expect(page).toHaveURL(/\/zh-TW\/$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-TW");
  });

  test("深色与浅色切换写回 data-theme", async ({ page }) => {
    await page.goto("/en/");
    const toggle = page.locator("button.icon-btn:visible").first();
    await expect(toggle).toHaveAttribute("aria-label", en.portal.toDark);

    await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    const back = page.locator("button.icon-btn:visible").first();
    await expect(back).toHaveAttribute("aria-label", en.portal.toLight);
    await back.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });

  test("区域筛选与「只看在线」按同一份数据收窄目录", async ({ page, request }) => {
    await page.goto("/en/");
    const data = await hubData(request);

    const chips = page.locator(".chips .chip");
    expect(await chips.count()).toBeGreaterThan(1);
    const second = chips.nth(1);
    const count = Number(await second.locator(".chip-count").innerText());
    expect(count).toBeGreaterThan(0);

    await second.click();
    await expect(second).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#nodes article.card")).toHaveCount(count);

    await chips.first().click();
    await expect(page.locator("#nodes article.card")).toHaveCount(data.instances.length);

    const online = page.locator('button.switch:not(.hot-switch)');
    await online.click();
    await expect(online).toHaveAttribute("aria-checked", "true");
    for (const card of await page.locator("#nodes article.card").all()) {
      expect(["up", "degraded"]).toContain(await card.getAttribute("data-status"));
    }
  });

  test("有橱窗时才出现「只看热点」，打开后只剩带热点的卡片", async ({ page, request }) => {
    await page.goto("/en/");
    const data = await hubData(request);
    const withCards = data.instances.filter((item) => (item.cards || []).length > 0);

    const hotSwitch = page.locator("button.hot-switch");
    if (!withCards.length) {
      await expect(hotSwitch).toHaveCount(0);
      return;
    }

    await expect(hotSwitch).toBeVisible();
    await hotSwitch.click();
    await expect(hotSwitch).toHaveAttribute("aria-checked", "true");

    const cards = page.locator("#nodes article.card");
    expect(await cards.count()).toBeGreaterThan(0);
    for (const card of await cards.all()) {
      await expect(card.locator(".hot")).toHaveCount(1);
    }
  });

  test("360 / 390 / 768 / 1280 宽都没有横向溢出", async ({ page }) => {
    for (const width of [1280, 768, 390, 360]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/en/");
      await expect(page.locator("h1#net-title")).toBeVisible();
      const overflow = await horizontalOverflow(page);
      expect(overflow, `${width}px 出现横向溢出`).toBeLessThanOrEqual(1);
    }
  });

  test("键盘可达：跳转链接先落焦点，目录与表单控件都有名字", async ({ page }) => {
    await page.goto("/en/");
    await page.keyboard.press("Tab");
    const skip = page.locator("a.skip");
    await expect(skip).toBeFocused();
    await expect(skip).toHaveAttribute("href", "#nodes");

    // 表单控件都有 label 或 aria-label，不靠 placeholder 充数。
    // 地址栏随模式切换：先选签发子域，再选自有域名，两边的 label 都要在。
    await page.locator('input[name="join-mode"][value="subdomain"]').check();
    for (const id of [
      "join-name",
      "join-subdomain",
      "join-intro",
      "join-operator",
      "join-email",
      "join-region",
      "join-timezone",
      "join-tags",
    ]) {
      await expect(page.locator(`label[for="${id}"]`)).toHaveCount(1);
    }

    await page.locator('input[name="join-mode"][value="own-domain"]').check();
    await expect(page.locator('label[for="join-domain"]')).toHaveCount(1);
    await expect(page.locator("a.admin-link")).toHaveAttribute("href", "/admin/");
  });
});
