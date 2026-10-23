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

  test("标签筛选按站点自己写的原文收窄目录", async ({ page, request }) => {
    await page.goto("/en/");
    const data = await hubData(request);
    const key = en.tag.label.toUpperCase();

    // 第一行是区域，第二行是标签。样例数据里必须有站点填了标签：没有就说明 fixtures
    // 被改瘦了，这时静默 return 会让这条用例悄悄空跑（S24-11），所以直接失败。
    const rows = page.locator(".chips");
    expect(await rows.count(), "样例数据里没有标签行").toBeGreaterThanOrEqual(2);
    const tags = rows.nth(1);
    await expect(tags).toHaveAttribute("aria-label", key);
    const chip = tags.locator(".chip").nth(1);
    const label = await chip.locator("span").first().innerText();
    const count = Number(await chip.locator(".chip-count").innerText());

    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#nodes article.card")).toHaveCount(count);
    for (const card of await page.locator("#nodes article.card").all()) {
      await expect(card.locator(".tag", { hasText: label }).first()).toBeVisible();
    }

    await tags.locator(".chip").first().click();
    await expect(page.locator("#nodes article.card")).toHaveCount(data.instances.length);
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
    // 样例数据里必须有带橱窗的实例：没有时下面的断言会全落空，用例看起来还是绿的。
    expect(withCards.length, "样例数据里没有带橱窗的实例").toBeGreaterThan(0);

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

  test("键盘可达：跳转链接先落焦点，登录与加入步骤都有名字", async ({ page }) => {
    await page.goto("/en/");
    await page.keyboard.press("Tab");
    const skip = page.locator("a.skip");
    await expect(skip).toBeFocused();
    await expect(skip).toHaveAttribute("href", "#nodes");

    // 右栏不再收申请表：登录只有邮箱与授权码两格，加入方式是四步说明。
    // 两格都要有 label，不靠 placeholder 充数。
    await expect(page.locator('label[for="member-email"]')).toHaveCount(1);
    await expect(page.locator("#member-email")).toHaveAttribute("type", "email");
    await expect(page.locator("#join ol.steps li")).toHaveCount(4);
    await expect(page.locator('a[href*="github.com/manwjh/AgentLink"]').first()).toBeVisible();
    await expect(page.locator("a.admin-link")).toHaveAttribute("href", "/admin/");
  });
});
