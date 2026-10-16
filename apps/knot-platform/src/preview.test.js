import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { PREVIEW_WIDTH, previewFrame, writeCardPreview } from "./preview.js";

function covers(frame) {
  const pixels = new Set();
  for (const cell of frame.cells) {
    assert.equal(cell.x + cell.w <= frame.width, true);
    assert.equal(cell.y + cell.h <= frame.height, true);
    pixels.add(`${cell.x},${cell.y}`);
  }
  assert.equal(pixels.size, frame.cells.length);
}

test("two, three, and four images use one collage frame", () => {
  const two = previewFrame(2);
  assert.equal(two.width, PREVIEW_WIDTH);
  assert.equal(two.height, PREVIEW_WIDTH / 2);
  assert.equal(two.cells.length, 2);
  covers(two);

  const three = previewFrame(3);
  assert.equal(three.cells.length, 3);
  assert.equal(three.cells[0].h, three.height);
  assert.ok(three.cells[1].y < three.cells[2].y);
  covers(three);

  const four = previewFrame(4);
  assert.equal(four.cells.length, 4);
  assert.equal(four.width, four.height);
  assert.equal(four.cells[0].x, 0);
  assert.equal(four.cells[0].y, 0);
  assert.equal(four.cells[1].y, 0);
  assert.ok(four.cells[1].x > four.cells[0].x);
  assert.equal(four.cells[2].x, 0);
  assert.ok(four.cells[2].y > 0);
  assert.ok(four.cells[3].x > 0);
  assert.ok(four.cells[3].y > 0);
  assert.equal(four.cells[0].w, four.cells[1].w);
  assert.equal(four.cells[0].h, four.cells[2].h);
  covers(four);
});

test("a preview jpeg is one picture, and several sources share one frame", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "knot-preview-"));
  try {
    const one = await sharp({
      create: { width: 40, height: 20, channels: 3, background: { r: 8, g: 102, b: 255 } },
    })
      .png()
      .toBuffer();
    const single = path.join(dir, "one.jpg");
    await writeCardPreview([one], single);
    const singleMeta = await sharp(single).metadata();
    assert.equal(singleMeta.format, "jpeg");
    assert.equal(singleMeta.width, 40);
    assert.equal(singleMeta.height, 20);

    const colors = [
      { r: 8, g: 102, b: 255 },
      { r: 66, g: 183, b: 42 },
      { r: 247, g: 185, b: 40 },
      { r: 228, g: 30, b: 63 },
    ];
    const sources = await Promise.all(
      colors.map((background) =>
        sharp({ create: { width: 80, height: 80, channels: 3, background } }).png().toBuffer()
      )
    );
    const collage = path.join(dir, "four.jpg");
    await writeCardPreview(sources, collage);
    const meta = await sharp(collage).metadata();
    const frame = previewFrame(4);
    assert.equal(meta.width, frame.width);
    assert.equal(meta.height, frame.height);

    const wide = await sharp({
      create: { width: 400, height: 40, channels: 3, background: { r: 220, g: 20, b: 20 } },
    })
      .png()
      .toBuffer();
    for (const count of [2, 3, 4]) {
      const fitted = path.join(dir, `fitted-${count}.jpg`);
      await writeCardPreview([wide, ...sources.slice(1, count)], fitted);
      const { data, info } = await sharp(fitted).raw().toBuffer({ resolveWithObject: true });
      const at = (x, y) => {
        const i = (y * info.width + x) * info.channels;
        return [data[i], data[i + 1], data[i + 2]];
      };
      const cell = previewFrame(count).cells[0];
      const [edgeR, edgeG, edgeB] = at(cell.x + 8, cell.y + 8);
      assert.ok(edgeR > 240 && edgeG > 240 && edgeB > 240);
      const [midR, midG, midB] = at(cell.x + Math.floor(cell.w / 2), cell.y + Math.floor(cell.h / 2));
      assert.ok(midR > 180 && midG < 80 && midB < 80);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
