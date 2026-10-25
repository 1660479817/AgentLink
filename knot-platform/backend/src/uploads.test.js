import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import sharp from "sharp";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AVATAR_PX, CARD_IMAGE_EDGE, acceptAvatar, avatarBufferError, ensureCardImage, fitAvatar, imageSize, storagePath } from "./uploads.js";

function png(width, height) {
  const buffer = Buffer.alloc(24);
  buffer.write("\x89PNG\r\n\x1a\n", 0, "binary");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function jpeg(width, height) {
  const buffer = Buffer.alloc(20);
  buffer[0] = 0xff;
  buffer[1] = 0xd8;
  buffer[2] = 0xff;
  buffer[3] = 0xc0;
  buffer.writeUInt16BE(11, 4);
  buffer[6] = 8;
  buffer.writeUInt16BE(height, 7);
  buffer.writeUInt16BE(width, 9);
  return buffer;
}

test("a square avatar is checked by decoding, not by its header", async () => {
  assert.equal(AVATAR_PX, 512);
  const make = (width, height, format) =>
    sharp({ create: { width, height, channels: 3, background: { r: 8, g: 102, b: 255 } } })[format]().toBuffer();
  const square = await make(512, 512, "png");
  assert.deepEqual(imageSize(square), { width: 512, height: 512 });
  assert.equal(await avatarBufferError(square), null);
  assert.equal(await avatarBufferError(await make(512, 512, "jpeg")), null);
  assert.equal(await avatarBufferError(await make(64, 64, "png")), null);
  assert.equal(await avatarBufferError(await make(1024, 1024, "png")), null);
  assert.equal(await avatarBufferError(await make(800, 600, "png")), "bad_avatar_square");
  // 24 字节伪造 PNG：头里写着 64×64，没有像素，解不出来。
  assert.equal(await avatarBufferError(png(64, 64)), "bad_avatar_square");
  assert.equal(await avatarBufferError(Buffer.from("not-an-image")), "bad_avatar_square");
});

test("avatars larger than 512 are compressed to a 512 jpeg", async () => {
  const big = await sharp({
    create: { width: 800, height: 800, channels: 3, background: { r: 8, g: 102, b: 255 } },
  })
    .png()
    .toBuffer();
  const fitted = await fitAvatar(big);
  const meta = await sharp(fitted).metadata();
  assert.equal(meta.format, "jpeg");
  assert.equal(meta.width, AVATAR_PX);
  assert.equal(meta.height, AVATAR_PX);

  const small = await sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 8, g: 102, b: 255 } },
  })
    .png()
    .toBuffer();
  assert.equal(await fitAvatar(small), null);
  const exact = await sharp({
    create: { width: AVATAR_PX, height: AVATAR_PX, channels: 3, background: { r: 8, g: 102, b: 255 } },
  })
    .png()
    .toBuffer();
  assert.equal(await fitAvatar(exact), null);
});

test("a transparent avatar is flattened onto white, not black", async () => {
  const mark = await sharp({
    create: { width: 800, height: 800, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .png()
    .toBuffer();
  const fitted = await fitAvatar(mark);
  const { data, info } = await sharp(fitted).raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.channels, 3);
  // 四角原本是透明，压平后必须是白，不能是 sharp 默认的纯黑。
  for (const [x, y] of [
    [0, 0],
    [info.width - 1, 0],
    [0, info.height - 1],
    [info.width - 1, info.height - 1],
  ]) {
    const at = (y * info.width + x) * info.channels;
    const [r, g, b] = [data[at], data[at + 1], data[at + 2]];
    assert.ok(r > 200 && g > 200 && b > 200, `corner ${x},${y} is ${r},${g},${b}`);
  }
});

test("a card image is a jpeg that fits the column", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "knot-card-"));
  try {
    const wide = await sharp({
      create: { width: 2400, height: 1200, channels: 3, background: { r: 20, g: 40, b: 80 } },
    })
      .png()
      .toBuffer();
    const widePath = storagePath(dir, "wide.png");
    await mkdir(path.dirname(widePath), { recursive: true });
    await writeFile(widePath, wide);
    const display = await ensureCardImage(dir, "wide.png");
    const again = await ensureCardImage(dir, "wide.png");
    assert.equal(again, display);
    const meta = await sharp(display).metadata();
    assert.equal(meta.format, "jpeg");
    assert.equal(meta.width, CARD_IMAGE_EDGE);
    assert.equal(meta.height, 640);

    const small = await sharp({
      create: { width: 400, height: 200, channels: 3, background: { r: 20, g: 40, b: 80 } },
    })
      .png()
    .toBuffer();
    const smallPath = storagePath(dir, "small.png");
    await mkdir(path.dirname(smallPath), { recursive: true });
    await writeFile(smallPath, small);
    const fitted = await sharp(await ensureCardImage(dir, "small.png")).metadata();
    assert.equal(fitted.width, 400);
    assert.equal(fitted.height, 200);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an avatar id that is not a uuid is rejected before the query", async () => {
  const calls = [];
  const pool = {
    async query(...args) {
      calls.push(args);
      return { rows: [] };
    },
  };
  const owner = "22222222-2222-4222-8222-222222222222";
  for (const id of ["not-a-uuid", "3333", ""]) {
    assert.deepEqual(await acceptAvatar(pool, "/tmp", owner, id), { error: "bad_avatar" }, id);
  }
  // 一次查询都没有：形状不对的 id 不进 uuid 列，pg 的 22P02 无从发生。
  assert.equal(calls.length, 0);
});

test("shrinking an avatar writes a new row and leaves the original bytes alone", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "knot-avatar-"));
  try {
    const id = "11111111-1111-4111-8111-111111111111";
    const next = "33333333-3333-4333-8333-333333333333";
    const name = `${id}.png`;
    const original = await sharp({
      create: { width: 800, height: 800, channels: 3, background: { r: 8, g: 102, b: 255 } },
    })
      .png()
      .toBuffer();
    const source = storagePath(dir, name);
    await mkdir(path.dirname(source), { recursive: true });
    await writeFile(source, original);

    const calls = [];
    const pool = {
      async query(sql, params = []) {
        calls.push({ sql, params });
        if (sql.includes("SELECT id, storage_name, mime")) {
          return { rows: [{ id, storage_name: name, mime: "image/png", original_name: "me.png" }] };
        }
        if (sql.includes("INSERT INTO uploads")) return { rows: [{ id: next }] };
        return { rows: [] };
      },
    };

    // 返回的是一张新的 upload：调用方据此改 accounts.avatar_upload_id。
    assert.deepEqual(await acceptAvatar(pool, dir, "22222222-2222-4222-8222-222222222222", id), { id: next });
    assert.equal(calls.some((call) => call.sql.includes("UPDATE uploads")), false, "no in-place rewrite");
    const insert = calls.find((call) => call.sql.includes("INSERT INTO uploads"));
    assert.ok(insert, "the avatar is a new upload row");
    const [accountId, storedName, originalName, size, sha256, width] = insert.params;
    assert.equal(accountId, "22222222-2222-4222-8222-222222222222");
    assert.match(storedName, /^[0-9a-f-]{36}\.jpg$/);
    assert.equal(originalName, "me.png");
    assert.equal(width, AVATAR_PX);

    const written = await readFile(storagePath(dir, storedName));
    assert.equal(size, written.length);
    assert.equal(sha256, createHash("sha256").update(written).digest("hex"));
    // 原件不动：可能还有一条旧帖子在引用它。
    assert.deepEqual(await readFile(source), original);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
