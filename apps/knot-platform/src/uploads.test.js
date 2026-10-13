import assert from "node:assert/strict";
import test from "node:test";
import { AVATAR_PX, avatarBufferError, imageSize } from "./uploads.js";

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

test("avatar files must be a 512 square", () => {
  assert.equal(AVATAR_PX, 512);
  assert.deepEqual(imageSize(png(512, 512)), { width: 512, height: 512 });
  assert.equal(avatarBufferError(png(512, 512)), null);
  assert.equal(avatarBufferError(jpeg(512, 512)), null);
  assert.equal(avatarBufferError(png(800, 600)), "bad_avatar_square");
  assert.equal(avatarBufferError(png(256, 256)), "bad_avatar_size");
  assert.equal(avatarBufferError(Buffer.from("not-an-image")), "bad_avatar_square");
});
