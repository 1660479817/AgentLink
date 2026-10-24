import assert from "node:assert/strict";
import test from "node:test";
import { LAYOUT_RULES, photoAspect, planPhotoBoxes, planPhotoLayout, planPhotoRows, rowShares } from "../src/index.js";

const LANDSCAPE = 1920 / 1080;
const PORTRAIT = 1080 / 1440;

function rowsFor(aspect, count) {
  return planPhotoRows(Array(count).fill(aspect));
}

function counts(rows) {
  return rows.map((row) => row.cells.length);
}

function cellsOf(rows) {
  return rows.flatMap((row) => row.cells);
}

function assertCoversAll(rows, count) {
  assert.deepEqual(cellsOf(rows), Array.from({ length: count }, (_, index) => index));
  assert.ok(rows.every((row) => row.cells.length > 0));
}

test("a row keeps every cell the picture's own ratio", () => {
  assert.equal(photoAspect({ width: 1920, height: 1080 }), 1920 / 1080);
  assert.equal(photoAspect({ width: 0, height: 0 }), 4 / 3);
  assert.equal(photoAspect({}), 4 / 3);
  // 极端比例夹在 0.4 到 3.5 之间：再长的全景只当全景，不该把一行压成一条线。
  assert.equal(photoAspect({ width: 400, height: 4000 }), 0.4);
  assert.equal(photoAspect({ width: 4000, height: 400 }), 3.5);
});

test("four landscape pictures take two rows instead of four squares", () => {
  const rows = rowsFor(LANDSCAPE, 4);
  assert.deepEqual(counts(rows), [2, 2]);
  assertCoversAll(rows, 4);
});

test("two landscape pictures share one row", () => {
  assert.deepEqual(counts(rowsFor(LANDSCAPE, 2)), [2]);
});

test("portrait pictures stay in one row while the row can still carry them", () => {
  assert.deepEqual(counts(rowsFor(PORTRAIT, 3)), [3]);
  assert.deepEqual(counts(rowsFor(PORTRAIT, 4)), [4]);
});

test("a crowded set falls into even rows of three", () => {
  for (const aspect of [LANDSCAPE, 1080 / 1080, PORTRAIT]) {
    assert.deepEqual(counts(rowsFor(aspect, 9)), [3, 3, 3]);
    assertCoversAll(rowsFor(aspect, 9), 9);
  }
  assert.deepEqual(counts(rowsFor(LANDSCAPE, 6)), [3, 3]);
  // 5 张横图：上面一行两张更大，下面一行三张，行高从上往下变小。
  assert.deepEqual(counts(rowsFor(LANDSCAPE, 5)), [2, 3]);
});

test("a tie puts the taller row on top", () => {
  // 3 张横图是「一张大图 + 下面两张」，不是反过来。
  assert.deepEqual(counts(rowsFor(LANDSCAPE, 3)), [1, 2]);
});

test("a row that would be too tall is cropped, not shrunk", () => {
  // 一张 1:1.6 的竖版长图：满宽一条，行高顶到 maxRow，多出来的下半截裁掉。
  const [tall] = planPhotoRows([1 / 1.6]);
  assert.equal(tall.cells.length, 1);
  assert.equal(tall.height, LAYOUT_RULES.maxRow);
  assert.ok(tall.cropped && tall.vertical);
  // 可见比例 = maxRow / 自然行高，1:1.6 的长图约看到八成。
  assert.ok(tall.height / tall.natural > 0.7);

  // 更长的截图裁得更多，但行高不会超过同一个上限，也不会因为「太长」换一种排法：
  // 比例先夹到 0.4，所以 1:8 与 1:2.5 在排版眼里是同一件事（可见一半），差的部分由 cover 继续收。
  const [long] = planPhotoRows([1 / 8]);
  assert.equal(long.height, LAYOUT_RULES.maxRow);
  assert.ok(long.cropped && long.vertical);
  assert.ok(long.height / long.natural <= 0.5);
});

test("a picture inside the rules is not cropped at all", () => {
  // 上限是 4:5：比它矮的竖图（1280x1440 之类）、方图、宽景都原样显示。
  for (const [width, height] of [[1920, 1080], [1080, 1080], [1200, 1400], [2400, 900]]) {
    const [row] = planPhotoRows([width / height]);
    assert.equal(row.cells.length, 1);
    assert.ok(!row.cropped, `${width}x${height} was cropped`);
    assert.ok(Math.abs(row.height - height / width) < 1e-9);
  }
});

test("one picture always fills the card width", () => {
  // 单图也是一行一格：行的比例就是行高的倒数，单元格 flex-grow 等于自身比例，
  // 因此一格总是占满整行——不管它是横是竖，都不会再缩成中间一条窄图。
  for (const aspect of [LANDSCAPE, PORTRAIT, 0.4, 3.5]) {
    const [row] = planPhotoRows([aspect]);
    assert.equal(row.aspect.toFixed(4), (1 / row.height).toFixed(4));
    assert.ok(row.height >= LAYOUT_RULES.minRow && row.height <= LAYOUT_RULES.maxRow);
  }
});

test("no cell gets narrower than a finger can hit", () => {
  // 一格最少占行宽的 16%，328px 的窄屏上约 52px，够得上 44px 的可点下限。
  for (const [width, height] of [[1920, 1080], [900, 1200], [1080, 1080], [1600, 2000]]) {
    for (let count = 2; count <= 9; count++) {
      const aspects = Array.from({ length: count }, () => height / width);
      for (const row of planPhotoRows(aspects)) {
        const sum = row.cells.reduce((total, index) => total + aspects[index], 0);
        for (const index of row.cells) {
          assert.ok(
            aspects[index] / sum >= LAYOUT_RULES.minCell - 1e-9,
            `${count} pictures gave a cell of ${Math.round((aspects[index] / sum) * 100)}%`
          );
        }
      }
    }
  }
  // 常见的竖横混排也要守住：一竖三横、两横两竖、五张混着来。
  for (const aspects of [[0.75, 1.78, 1.78, 1.78], [1.78, 1.78, 0.75, 0.75], [0.75, 1.78, 1, 1.78, 0.75]]) {
    for (const row of planPhotoRows(aspects)) {
      const sum = row.cells.reduce((total, index) => total + aspects[index], 0);
      for (const index of row.cells) {
        assert.ok(
          aspects[index] / sum >= LAYOUT_RULES.minCell - 1e-9,
          `mixed set gave a cell of ${Math.round((aspects[index] / sum) * 100)}%`
        );
      }
    }
  }
});

test("no row is longer than the rule allows", () => {
  for (const count of [2, 3, 4, 5, 6, 7, 8, 9]) {
    for (const row of rowsFor(PORTRAIT, count)) {
      assert.ok(row.cells.length <= LAYOUT_RULES.maxPerRow, `${count} pictures gave a row of ${row.cells.length}`);
    }
  }
});

test("a row's height is the inverse of its aspect sum unless it is cropped", () => {
  const sets = [
    Array(4).fill(LANDSCAPE),
    Array(9).fill(PORTRAIT),
    [PORTRAIT, LANDSCAPE, LANDSCAPE],
    [1.78, 0.75, 1, 1.78, 0.75],
    [1 / 1.6, 1.78, 1.78],
  ];
  for (const aspects of sets) {
    for (const row of planPhotoRows(aspects)) {
      const sum = row.cells.reduce((total, index) => total + aspects[index], 0);
      assert.ok(Math.abs(row.natural - 1 / sum) < 1e-9);
      if (!row.cropped) assert.ok(Math.abs(row.height - 1 / sum) < 1e-9);
      assert.ok(row.height >= LAYOUT_RULES.minRow - 1e-9 && row.height <= LAYOUT_RULES.maxRow + 1e-9);
      // 裁切方向：行高比自然值矮是裁上下，高是裁左右。
      if (row.cropped) assert.equal(row.vertical, row.height < row.natural);
    }
  }
});

test("a mixed set shares one row height", () => {
  const rows = planPhotoRows([PORTRAIT, LANDSCAPE, LANDSCAPE]);
  assert.deepEqual(counts(rows), [3]);
  assertCoversAll(rows, 3);
  const tall = planPhotoRows([LANDSCAPE, PORTRAIT, PORTRAIT, PORTRAIT]);
  assertCoversAll(tall, 4);
});

test("one picture is planned as a row of one", () => {
  const plan = planPhotoLayout([{ url: "/a", width: 1200, height: 1600 }]);
  assert.equal(plan.rows.length, 1);
  assert.deepEqual(plan.rows[0].cells, [0]);
  assert.ok(plan.rows[0].cropped, "a 3:4 picture is cropped to the 4:5 ceiling");
  assert.deepEqual(planPhotoLayout([]), { rows: [] });
});

test("pictures without a url are left out of the plan", () => {
  const plan = planPhotoLayout([{ url: "/a" }, { url: "" }, null, { url: "/b" }]);
  assert.deepEqual(plan.rows.map((row) => row.cells), [[0, 1]]);
});

test("a plan is stable and cheap enough for a feed", () => {
  const aspects = Array.from({ length: 9 }, (_, index) => (index % 2 ? LANDSCAPE : PORTRAIT));
  const started = process.hrtime.bigint();
  for (let run = 0; run < 200; run++) planPhotoRows(aspects);
  const each = Number(process.hrtime.bigint() - started) / 200 / 1e6;
  // 只是护栏：真跑起来是微秒级，比一帧的千分之一还小。
  assert.ok(each < 5, `one plan took ${each.toFixed(3)}ms`);
});

test("each row's shares add up to one", () => {
  // 份额归一之后，flex 才一定铺满整行（grow 之和小于 1 时浏览器会留下空档）。
  for (const aspects of [[1], [0.75], [LANDSCAPE, LANDSCAPE], [0.4, 1.78, 3.5, 1]]) {
    for (const row of planPhotoRows(aspects)) {
      const total = rowShares(aspects, row.cells).reduce((sum, share) => sum + share, 0);
      assert.ok(Math.abs(total - 1) < 1e-9, `shares added up to ${total}`);
    }
  }
});

test("boxes fill the width and stack in the planned rows", () => {
  const photos = [
    { width: 1920, height: 1080 },
    { width: 1080, height: 1440 },
    { width: 1080, height: 1080 },
    { width: 1200, height: 800 },
  ];
  const plan = planPhotoBoxes(photos, { width: 936, gap: 2, x: 72, y: 300 });
  assert.equal(plan.boxes.length, 4);
  // 每行首尾贴住内容区的左右边，宽度之和加上间隔正好是 936。
  let index = 0;
  for (const row of plan.rows) {
    const cells = plan.boxes.slice(index, index + row.cells.length);
    assert.equal(cells[0].x, 72);
    const last = cells[cells.length - 1];
    assert.equal(last.x + last.width, 72 + 936);
    const span = cells.reduce((sum, cell) => sum + cell.width, 0) + 2 * (cells.length - 1);
    assert.equal(span, 936);
    assert.ok(cells.every((cell) => cell.height === cells[0].height));
    index += row.cells.length;
  }
  // 行与行之间留 2px，整块高度可以按行高算出来。
  const rowsHeight = plan.rows.reduce((sum, row) => sum + Math.round(row.height * 936), 0);
  assert.equal(plan.height, rowsHeight + 2 * (plan.rows.length - 1));
  // 第二行落在第一行下面，不会叠上去。
  const firstBottom = plan.boxes[0].y + plan.boxes[0].height;
  const secondRow = plan.boxes[plan.rows[0].cells.length];
  assert.equal(secondRow.y, firstBottom + 2);
});

test("a taller budget keeps a portrait screenshot whole in the share poster", () => {
  const tall = { width: 598, height: 949 };
  const card = planPhotoBoxes([tall], { width: 936 });
  assert.equal(card.boxes[0].cropped, true);
  // 分享图的预算更宽：同一张图不裁，行高就是它的自然高度。
  const poster = planPhotoBoxes([tall], { width: 936, rules: { ...LAYOUT_RULES, maxRow: 3, maxCard: 3 } });
  assert.equal(poster.boxes[0].cropped, false);
  assert.equal(poster.boxes[0].height, Math.round((949 / 598) * 936));
});

