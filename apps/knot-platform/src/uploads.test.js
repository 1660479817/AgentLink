import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AVATAR_PX, CARD_IMAGE_EDGE, avatarBufferError, ensureCardImage, fitAvatar, imageSize } from "./uploads.js";

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

test("a card image is a jpeg that fits the column", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "knot-card-"));
  try {
    const wide = await sharp({
      create: { width: 2400, height: 1200, channels: 3, background: { r: 20, g: 40, b: 80 } },
    })
      .png()
      .toBuffer();
    await writeFile(path.join(dir, "wide.png"), wide);
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
    await writeFile(path.join(dir, "small.png"), small);
    const fitted = await sharp(await ensureCardImage(dir, "small.png")).metadata();
    assert.equal(fitted.width, 400);
    assert.equal(fitted.height, 200);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
