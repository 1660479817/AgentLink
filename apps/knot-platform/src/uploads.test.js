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

test("any square avatar is accepted", () => {
  assert.equal(AVATAR_PX, 512);
  assert.deepEqual(imageSize(png(512, 512)), { width: 512, height: 512 });
  assert.equal(avatarBufferError(png(512, 512)), null);
  assert.equal(avatarBufferError(jpeg(512, 512)), null);
  assert.equal(avatarBufferError(png(64, 64)), null);
  assert.equal(avatarBufferError(png(1024, 1024)), null);
  assert.equal(avatarBufferError(png(800, 600)), "bad_avatar_square");
  assert.equal(avatarBufferError(Buffer.from("not-an-image")), "bad_avatar_square");
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

test("shrinking an avatar refreshes the stored size, digest and dimensions", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "knot-avatar-"));
  try {
    const id = "11111111-1111-4111-8111-111111111111";
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
          return { rows: [{ id, storage_name: name, mime: "image/png" }] };
        }
        return { rows: [] };
      },
    };

    assert.deepEqual(await acceptAvatar(pool, dir, "22222222-2222-4222-8222-222222222222", id), { id });
    const update = calls.find((call) => call.sql.includes("UPDATE uploads"));
    assert.ok(update, "the upload row is updated");
    const [nextName, size, sha256, width, height] = update.params;
    assert.equal(nextName, `${id}.jpg`);
    assert.equal(width, AVATAR_PX);
    assert.equal(height, AVATAR_PX);

    const written = await readFile(storagePath(dir, nextName));
    assert.equal(size, written.length);
    assert.equal(sha256, createHash("sha256").update(written).digest("hex"));
    assert.equal(fs.existsSync(storagePath(dir, name)), false, "the original png is removed");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
