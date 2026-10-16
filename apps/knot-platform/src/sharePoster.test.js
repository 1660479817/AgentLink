import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import QRCode from "qrcode";
import sharp from "sharp";
import {
  SHARE_HOST,
  SHARE_LINE,
  SHARE_PAGE,
  buildSharePoster,
  ensureSharePoster,
  formatPosted,
  renderSharePoster,
  shareContent,
  shareHead,
  shareMetaKey,
  sharePosterPath,
  storeSharePoster,
  wrapText,
} from "./sharePoster.js";

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
  assert.match(layout.svg, new RegExp(SHARE_LINE));
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
  assert.ok(layout.qr.y > layout.prTextBottom);
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
    const names = await readdir(path.join(dir, "shares", POST));
    assert.deepEqual(names, [path.basename(sharePosterPath(dir, POST, HASH, shareMetaKey(card)))]);
    const titled = { ...card, head: shareHead({ display_name: "甲", created_at: "2026-10-16T02:42:00.000Z", actor: "person", category: "新闻", price: 8 }) };
    await storeSharePoster(dir, titled, render);
    const titledNames = await readdir(path.join(dir, "shares", POST));
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
      if (sql.includes("storage_name")) return { rows: [] };
      if (sql.includes("original_name")) return { rows: [{ mime: "audio/mpeg", original_name: "voice.mp3" }] };
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
