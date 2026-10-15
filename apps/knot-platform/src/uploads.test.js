import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { AVATAR_PX, avatarBufferError, fitAvatar, imageSize } from "./uploads.js";

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
