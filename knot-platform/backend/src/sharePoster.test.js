import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import QRCode from "qrcode";
import sharp from "sharp";
import {
  MAX_HEIGHT,
  MAX_PREVIEW_HEIGHT,
  SHARE_HOST,
  SHARE_PAGE,
  buildSharePoster,
  ensureSharePoster,
  formatPosted,
  loadShareCard,
  markdownTexts,
  priceLabel,
  renderSharePoster,
  shareContent,
  shareHead,
  shareMetaKey,
  sharePosterPath,
  shareUrl,
  shareSite,
  storeSharePoster,
  wrapText,
} from "./sharePoster.js";
import { derivedDir } from "./storage.js";

const POST = "11111111-1111-4111-8111-111111111111";
const HASH = "a".repeat(64);
const HASH_B = "b".repeat(64);

function darkModules() {
  const qr = QRCode.create(SHARE_PAGE, { errorCorrectionLevel: "M" });
  let dark = 0;
  for (let row = 0; row < qr.modules.size; row += 1) {
    for (let col = 0; col < qr.modules.size; col += 1) if (qr.modules.get(row, col)) dark += 1;
  }
  return dark;
}

test("long text wraps onto more than one line", () => {
  const lines = wrapText("信息交换网".repeat(30), 200, 32, 4);
  assert.equal(lines.length, 4);
  assert.equal(lines[3].endsWith("…"), true);
  const sentence = wrapText("这是一条分享到 Knot 的信息。人或 Agent 都能读，下载按报价结算。", 936, 40, 8);
  assert.equal(sentence.some((line) => line.startsWith("，")), false);
});

test("markdown blocks keep their structure", () => {
  const items = markdownTexts(
    "# 标题\n\n段落有 **加粗** 与 `代码`。\n\n- 甲\n- 乙\n\n1. 丙\n2. 丁\n\n> 引用\n\n```\nconst x = 1;\n```"
  );
  const heading = items[0];
  assert.equal(heading.segments[0].text, "标题");
  assert.equal(heading.size, 52);
  assert.equal(heading.weight, "600");
  const para = items.find((item) => item.segments?.some((segment) => segment.bold));
  assert.ok(para);
  assert.ok(para.segments.some((segment) => segment.text === "加粗" && segment.bold));
  assert.ok(para.segments.some((segment) => segment.text === "代码" && segment.code));
  const bullets = items.filter((item) => item.prefix === "•");
  assert.equal(bullets.length, 2);
  assert.equal(bullets[0].segments[0].text, "甲");
  const ordered = items.filter((item) => item.prefix === "1." || item.prefix === "2.");
  assert.equal(ordered.length, 2);
  assert.equal(ordered[0].segments[0].text, "丙");
  const quote = items.find((item) => item.quote);
  assert.equal(quote.fill, "#65676B");
  const code = items.find((item) => item.code);
  assert.equal(code.segments[0].code, true);
  assert.equal(code.segments[0].text, "const x = 1;");
});

test("a markdown post is drawn with formatted runs", async () => {
  const layout = await buildSharePoster({
    body: "# 标题\n\n这是 **加粗** 和 `代码`，还有 [链接](https://wang.xknot.si)。",
    video: false,
    audioName: "",
    fileName: "",
    image: false,
    preview: "",
  });
  assert.match(layout.svg, /font-size="52"[^>]*font-weight="600"/);
  assert.match(layout.svg, /<tspan/);
  assert.match(layout.svg, /加粗/);
  assert.match(layout.svg, /fill="#0866FF"/);
});

test("the picture shows the post, the introduction, and a code for the site", async () => {
  const content = shareContent(
    {
      body: "一条给 Agent 读的信息 & <说明>",
      videos: [{ url: "https://www.youtube.com/watch?v=abc123xyz", poster: "https://i.ytimg.com/vi/abc123xyz/hqdefault.jpg" }],
      links: { audio: [{ name: "讲解.mp3", url: "https://cdn.example/a.mp3" }] },
    },
    []
  );
  assert.equal(content.video, true);
  assert.equal(content.audioName, "讲解.mp3");
  assert.equal(JSON.stringify(content).includes("ytimg"), false);
  assert.equal(JSON.stringify(content).includes("youtube"), false);

  const layout = await buildSharePoster({ ...content, preview: "" });
  assert.match(layout.svg, /一条给 Agent 读的信息 &amp; &lt;说明&gt;/);
  assert.match(layout.svg, /讲解\.mp3/);
  // 页脚文字现在只占左栏，标语会折成两行，按首尾两段检查。
  assert.match(layout.svg, /面向 AI 时代/);
  assert.match(layout.svg, /信息交换网。/);
  assert.match(layout.svg, new RegExp(SHARE_HOST));
  assert.equal(layout.svg.includes("ytimg"), false);
  assert.equal(layout.svg.includes("youtube"), false);
  assert.equal(layout.svg.includes("作者"), false);
  const modules = layout.svg.match(new RegExp(`width="${layout.qr.pixel}" height="${layout.qr.pixel}" fill="#050505"`, "g")) || [];
  assert.equal(modules.length, darkModules());
  assert.equal(layout.qr.dark, darkModules());
  assert.equal(layout.width, 1080);
  assert.equal(layout.footerTop, layout.contentBottom + 32);
  assert.ok(layout.contentTop > 56);
  assert.match(layout.svg, /用户/);
  assert.ok(layout.height > layout.footerTop);
  // 页脚改成横排两栏：固定信息区不超过 460px，二维码贴右内边距。
  const footerHeight = layout.height - layout.footerTop;
  assert.ok(footerHeight <= 460, `footer ${footerHeight}`);
  assert.ok(layout.qr.y >= layout.footerTop);
  assert.ok(layout.qr.y + layout.qr.size <= layout.footerTop + footerHeight);
  assert.equal(layout.qr.x + layout.qr.size + 12, 1080 - 72);
  assert.match(layout.svg, new RegExp(`<rect x="0" y="${layout.footerTop}" width="1080"`));
  assert.match(layout.svg, /rx="20" fill="#FFFFFF"/);

  const jpeg = await renderSharePoster({ ...content, preview: "" });
  const meta = await sharp(jpeg).metadata();
  assert.equal(meta.format, "jpeg");
  assert.equal(meta.width, 1080);
  assert.equal(meta.height, layout.height);

  const brief = await buildSharePoster({ body: "短", video: false, audioName: "", fileName: "", image: false, preview: "" });
  const longer = await buildSharePoster({ body: "内容".repeat(80), video: false, audioName: "", fileName: "", image: false, preview: "" });
  assert.ok(longer.height > brief.height);
  assert.ok(brief.height < 1920);
});

test("the top bar names who posted, when, the type, and the price", async () => {
  const head = shareHead({
    display_name: "甲",
    created_at: "2026-10-16T02:42:00.000Z",
    actor: "personal_agent",
    category: "新闻",
    price: 12,
  });
  assert.equal(formatPosted(head.posted), "2026年10月16日 10:42");
  assert.equal(head.actor, "personal_agent");
  assert.equal(head.price, 12);
  const layout = await buildSharePoster({
    body: "只有一句话。",
    video: false,
    audioName: "",
    fileName: "",
    image: false,
    preview: "",
    head,
  });
  assert.match(layout.svg, /甲/);
  assert.match(layout.svg, /Agent/);
  assert.match(layout.svg, /2026年10月16日 10:42/);
  assert.match(layout.svg, /新闻/);
  assert.match(layout.svg, />12</);
  assert.ok(layout.contentTop < layout.contentBottom);
  const plain = shareHead({ display_name: "乙", created_at: "2026-10-16T02:42:00.000Z", actor: "person", price: 0 });
  assert.equal(plain.category, "");
  assert.equal(priceLabel(plain.price), "");
  assert.equal(priceLabel(12), "12");
  assert.equal(priceLabel(-3), "");
  assert.equal(priceLabel("abc"), "");
  const pending = await buildSharePoster({
    body: "还没分类。",
    video: false,
    audioName: "",
    fileName: "",
    image: false,
    preview: "",
    head: plain,
  });
  assert.match(pending.svg, /乙/);
  assert.match(pending.svg, />人</);
  assert.equal(pending.svg.includes("新闻"), false);
});

test("a stored preview is drawn and an external cover is not", async () => {
  const preview = await sharp({
    create: { width: 80, height: 40, channels: 3, background: { r: 210, g: 20, b: 20 } },
  })
    .png()
    .toBuffer();
  const layout = await buildSharePoster({
    body: "",
    video: false,
    audioName: "",
    fileName: "",
    image: true,
    preview,
  });
  assert.equal(layout.svg.includes("图片"), false);
  assert.ok(layout.previewBox);
  const jpeg = await renderSharePoster({
    body: "",
    video: false,
    audioName: "",
    fileName: "",
    image: true,
    preview,
  });
  const { data, info } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
  const box = layout.previewBox;
  const offset = (box.y + 8) * info.width * info.channels + (box.x + 8) * info.channels;
  assert.ok(data[offset] > data[offset + 1] + 40);
});

test("the first share writes the picture and the next share reads it", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "knot-share-"));
  const card = {
    id: POST,
    contentHash: HASH,
    body: "同一条",
    video: false,
    audioName: "",
    fileName: "",
    image: false,
    preview: "",
  };
  let drawn = 0;
  const render = async (value) => {
    drawn += 1;
    return renderSharePoster(value);
  };
  try {
    const first = await storeSharePoster(dir, card, render);
    const second = await storeSharePoster(dir, card, render);
    assert.equal(first, second);
    assert.equal(drawn, 1);
    let slow = 0;
    const renderSlow = async (value) => {
      slow += 1;
      await new Promise((resolve) => setTimeout(resolve, 40));
      return renderSharePoster(value);
    };
    const other = { ...card, contentHash: HASH_B, body: "改过的" };
    await rm(first);
    const both = await Promise.all([
      storeSharePoster(dir, other, renderSlow),
      storeSharePoster(dir, other, renderSlow),
    ]);
    assert.equal(both[0], both[1]);
    assert.equal(slow, 1);
    await storeSharePoster(dir, card, render);
    const names = await readdir(path.join(derivedDir(dir, "shares"), POST));
    assert.deepEqual(names, [path.basename(sharePosterPath(dir, POST, HASH, shareMetaKey(card)))]);
    const titled = { ...card, head: shareHead({ display_name: "甲", created_at: "2026-10-16T02:42:00.000Z", actor: "person", category: "新闻", price: 8 }) };
    await storeSharePoster(dir, titled, render);
    const titledNames = await readdir(path.join(derivedDir(dir, "shares"), POST));
    assert.deepEqual(titledNames, [path.basename(sharePosterPath(dir, POST, HASH, shareMetaKey(titled)))]);
    assert.equal(drawn, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a post that is not on the public feed does not get a picture", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "knot-share-"));
  const pool = {
    async query() {
      return {
        rows: [
          {
            id: POST,
            content_hash: HASH,
            body: "只有自己",
            videos: [],
            links: {},
            kind: "post",
            is_public: false,
            verdict: "passed",
          },
        ],
      };
    },
  };
  try {
    assert.equal(await ensureSharePoster(pool, POST, dir), null);
    assert.equal(await ensureSharePoster(pool, "not-an-id", dir), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a public post is drawn once and then reused", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "knot-share-"));
  const row = {
    id: POST,
    content_hash: HASH,
    body: "公开的一条",
    videos: [],
    links: {},
    kind: "fastpost",
    is_public: true,
    verdict: "pending",
    actor: "person",
    category: "",
    price: 8,
    created_at: "2026-10-16T02:42:00.000Z",
    display_name: "甲",
  };
  const pool = {
    async query(sql) {
      if (sql.includes("original_name")) return { rows: [{ mime: "audio/mpeg", original_name: "voice.mp3", storage_name: "voice.bin" }] };
      if (sql.includes("FROM intel")) return { rows: [row] };
      throw new Error(sql);
    },
  };
  let drawn = 0;
  const render = async (card) => {
    drawn += 1;
    assert.equal(card.audioName, "voice.mp3");
    assert.equal(card.head.author, "甲");
    assert.equal(card.head.price, 8);
    return renderSharePoster(card);
  };
  try {
    const file = await ensureSharePoster(pool, POST, dir, render);
    assert.equal(typeof file, "string");
    await ensureSharePoster(pool, POST, dir, render);
    assert.equal(drawn, 1);
    const meta = await sharp(file).metadata();
    assert.equal(meta.format, "jpeg");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the QR points at the post's discover deep link", async () => {
  // 期望值从 shareUrl 用的同一处配置来：这台机器上 KNOT_SITE 可能指向任意站点，
  // 拿模块级 SHARE_PAGE（schema 默认值）当期望，会把「测试依赖外部环境」变成部署失败。
  const page = shareSite().page.replace(/\/$/, "");
  assert.equal(
    shareUrl("11111111-1111-4111-8111-111111111111"),
    `${page}/discover?post=11111111-1111-4111-8111-111111111111`,
  );
  // 显式给站点时结果与进程环境无关，深链拼接本身仍然被钉死。
  assert.equal(
    shareUrl("11111111-1111-4111-8111-111111111111", { page: "https://example.test/" }),
    "https://example.test/discover?post=11111111-1111-4111-8111-111111111111",
  );
  assert.equal(shareUrl(""), page);
  const withId = await buildSharePoster({ id: "22222222-2222-4222-8222-222222222222", body: "短", video: false, audioName: "", fileName: "", image: false, preview: "" });
  const withoutId = await buildSharePoster({ body: "短", video: false, audioName: "", fileName: "", image: false, preview: "" });
  assert.notEqual(withId.qr.dark, withoutId.qr.dark);
  // 深链二维码比首页二维码大一圈，但整条页脚仍然压在 460px 以内。
  assert.ok(withId.qr.size > withoutId.qr.size);
  assert.ok(withId.height - withId.footerTop <= 460);
});

test("a long site name and tagline still fit the footer columns", async () => {
  const site = {
    // 子域很长时二维码版本变高，像素自动降到 7，页脚仍然压在 460 以内。
    page: "https://a-very-long-subdomain.xknot.si",
    host: "a-very-long-subdomain.xknot.si",
    name: "一个名字特别长的站点".repeat(4),
    line: "面向 AI 时代、服务于 Agent 的信息交换网。".repeat(3),
  };
  const layout = await buildSharePoster(
    { id: "6fab96ff-ac84-4822-8e4c-4448a78e7be6", body: "短", video: false, audioName: "", fileName: "", image: false, preview: "" },
    site
  );
  // 页脚高度只由二维码和白边决定，文字再长也不再拉高整张图。
  // 二维码模块数随 id 内容变（33、37 或 41），整条固定区在 424–456 之间。
  const footerHeight = layout.height - layout.footerTop;
  assert.ok(footerHeight >= 400 && footerHeight <= 460, `footer ${footerHeight}`);
  assert.match(layout.svg, /…/);
  // 二维码贴右内边距，左边留给文字与两栏之间的间距。
  assert.equal(layout.qr.pixel, 7);
  assert.equal(layout.qr.x, 1080 - 72 - 12 - layout.qr.size);
});

test("the head composites the author's avatar over the letter fallback", async () => {
  const avatar = await sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 200, g: 30, b: 30 } } }).png().toBuffer();
  const head = shareHead({ display_name: "甲", created_at: "2026-10-16T02:42:00.000Z", actor: "person", price: 0 });
  const layout = await buildSharePoster({ body: "头像测试", video: false, audioName: "", fileName: "", image: false, preview: "", head });
  assert.ok(layout.avatarBox);
  const jpeg = await renderSharePoster({ body: "头像测试", video: false, audioName: "", fileName: "", image: false, preview: "", avatarPath: avatar, head });
  const { data, info } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
  const box = layout.avatarBox;
  const offset = (Math.floor(box.y + box.size / 2) * info.width + Math.floor(box.x + box.size / 2)) * info.channels;
  assert.ok(data[offset] > 150 && data[offset + 1] < 90 && data[offset + 2] < 90);
});

test("a failed render is caught by the caller and tried again next time", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "knot-share-"));
  const card = {
    id: POST,
    contentHash: HASH,
    body: "同一条",
    video: false,
    audioName: "",
    fileName: "",
    image: false,
    preview: "",
  };
  const unhandled = [];
  const listener = (error) => unhandled.push(error);
  process.on("unhandledRejection", listener);
  let drawn = 0;
  try {
    await assert.rejects(
      storeSharePoster(dir, card, async () => {
        drawn += 1;
        throw new Error("render failed");
      }),
      /render failed/
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(unhandled.length, 0);
    const file = await storeSharePoster(dir, card, async (value) => {
      drawn += 1;
      return renderSharePoster(value);
    });
    assert.equal(drawn, 2);
    const meta = await sharp(file).metadata();
    assert.equal(meta.format, "jpeg");
  } finally {
    process.off("unhandledRejection", listener);
    await rm(dir, { recursive: true, force: true });
  }
});

test("a post longer than the height budget is cut with an ellipsis", async () => {
  const body = "这是一条很长的信息。".repeat(2200);
  const content = { body, video: false, audioName: "", fileName: "", image: false, preview: "" };
  const layout = await buildSharePoster(content);
  assert.ok(layout.height <= MAX_HEIGHT);
  assert.match(layout.svg, /…/);

  const jpeg = await renderSharePoster(content);
  const meta = await sharp(jpeg).metadata();
  assert.equal(meta.format, "jpeg");
  assert.equal(meta.height, layout.height);
});

test("an extremely tall preview is cropped instead of stretching the picture", async () => {
  const preview = await sharp({ create: { width: 60, height: 6000, channels: 3, background: { r: 1, g: 2, b: 3 } } })
    .png()
    .toBuffer();
  const content = { body: "", video: false, audioName: "", fileName: "", image: true, preview };
  const layout = await buildSharePoster(content);
  assert.equal(layout.previewBox.height, MAX_PREVIEW_HEIGHT);
  assert.ok(layout.height <= MAX_HEIGHT);
  const jpeg = await renderSharePoster(content);
  const meta = await sharp(jpeg).metadata();
  assert.equal(meta.height, layout.height);
});

function picture(width, height, color) {
  return sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();
}

test("several pictures are joined into one collage, in the card's own arrangement", async () => {
  const red = await picture(400, 300, { r: 210, g: 20, b: 20 });
  const green = await picture(400, 300, { r: 20, g: 160, b: 40 });
  const content = {
    body: "两张图",
    video: false,
    audioName: "",
    fileName: "",
    image: true,
    photos: [
      { file: red, width: 400, height: 300 },
      { file: green, width: 400, height: 300 },
    ],
  };
  const layout = await buildSharePoster(content);
  // 两张 4:3 横图并成一行，各占一半——和卡片上的排法一致。
  assert.equal(layout.photoBoxes.length, 2);
  assert.equal(layout.previewBox, null);
  assert.equal(layout.photoBoxes[0].y, layout.photoBoxes[1].y);
  assert.ok(layout.photoBoxes[0].x < layout.photoBoxes[1].x);
  assert.equal(layout.photoBoxes[0].x, 72);
  assert.equal(layout.photoBoxes[1].x + layout.photoBoxes[1].width, 72 + 936);
  // 拼图和正文都画得下，不靠「图片」占位。
  assert.equal(layout.svg.includes(">图片<"), false);
  assert.ok(layout.contentBottom >= layout.photoTop + layout.photoHeight);
  assert.ok(layout.height <= MAX_HEIGHT);

  const jpeg = await renderSharePoster(content);
  const { data, info } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
  const sample = (box, dx, dy) => {
    const offset = (box.y + dy) * info.width * info.channels + (box.x + dx) * info.channels;
    return [data[offset], data[offset + 1], data[offset + 2]];
  };
  const left = sample(layout.photoBoxes[0], 20, 20);
  const right = sample(layout.photoBoxes[1], 20, 20);
  assert.ok(left[0] > 150 && left[1] < 90, `left ${left}`);
  assert.ok(right[1] > 110 && right[0] < 90, `right ${right}`);
});

test("a long screenshot keeps the top and never eats the whole picture", async () => {
  const tall = await picture(300, 2400, { r: 30, g: 60, b: 200 });
  const content = { body: "", video: false, audioName: "", fileName: "", image: true, photos: [{ file: tall, width: 300, height: 2400 }] };
  const layout = await buildSharePoster(content);
  const box = layout.photoBoxes[0];
  // 比 1:2.5 还长的截图按 1:2.5 记（再长就跟内容无关了），行高仍在 3 倍内容宽以内。
  assert.equal(box.height, Math.round(2.5 * 936));
  assert.ok(box.height <= 3 * 936);
  assert.ok(layout.height <= MAX_HEIGHT);
  const jpeg = await renderSharePoster(content);
  const { data, info } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
  // 裁的是下半截：框顶那几行是原图的开头（蓝），不是空白。
  const offset = (box.y + 12) * info.width * info.channels + (box.x + 12) * info.channels;
  assert.ok(data[offset + 2] > 120 && data[offset] < 120);
});

test("a post with several pictures is read as a photo set", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "knot-share-"));
  const row = {
    id: POST,
    content_hash: HASH,
    body: "三张图",
    videos: [],
    links: {},
    kind: "post",
    is_public: true,
    verdict: "passed",
    actor: "person",
    category: "",
    price: 0,
    created_at: "2026-10-16T02:42:00.000Z",
    display_name: "甲",
  };
  const files = [
    { mime: "image/png", original_name: "a.png", storage_name: "aa11111111111111.bin", width: 1200, height: 800 },
    { mime: "image/png", original_name: "b.png", storage_name: "bb22222222222222.bin", width: 800, height: 1200 },
  ];
  for (const file of files) {
    await mkdir(path.join(dir, "blobs", file.storage_name.slice(0, 2)), { recursive: true });
    await writeFile(path.join(dir, "blobs", file.storage_name.slice(0, 2), file.storage_name), await picture(60, 40, { r: 10, g: 10, b: 10 }));
  }
  const pool = {
    async query(sql) {
      if (sql.includes("original_name")) return { rows: files };
      if (sql.includes("FROM intel")) return { rows: [row] };
      throw new Error(sql);
    },
  };
  try {
    const card = await loadShareCard(pool, POST, dir);
    assert.equal(card.photos.length, 2);
    assert.equal(card.preview, "");
    assert.deepEqual(card.photos.map((photo) => [photo.width, photo.height]), [[1200, 800], [800, 1200]]);
    // 少一张尺寸就退回单图，不按 4:3 硬猜。
    const mixed = {
      async query(sql) {
        if (sql.includes("original_name")) return { rows: [files[0], { ...files[1], width: null, height: null }] };
        if (sql.includes("FROM intel")) return { rows: [row] };
        throw new Error(sql);
      },
    };
    const fallback = await loadShareCard(mixed, POST, dir);
    assert.deepEqual(fallback.photos, []);
    assert.ok(fallback.preview.endsWith(files[0].storage_name));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

