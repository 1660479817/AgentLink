import assert from "node:assert/strict";
import test from "node:test";

import { MIN_GAP, placePoints, RING } from "./placement.js";
import { WORLD } from "./world.js";

const at = (x, y, id = `${x},${y}`) => ({ id, x, y });

test("a lone point keeps the coordinate the projection gave it", () => {
  const { points, spokes, anchors } = placePoints([at(760, 130)]);
  assert.deepEqual(points.map((point) => [point.x, point.y]), [[760, 130]]);
  assert.equal(points[0].origin, undefined);
  assert.deepEqual(spokes, []);
  assert.deepEqual(anchors, []);
});

test("points sharing one coordinate fan out around it instead of stacking", () => {
  const input = [at(760, 130, "a"), at(760, 130, "b"), at(760, 130, "c"), at(760, 130, "d")];
  const { points, spokes, anchors } = placePoints(input);

  assert.equal(points.length, 4);
  assert.equal(spokes.length, 4);
  assert.deepEqual(anchors, [{ x: 760, y: 130, count: 4 }]);

  const radius = Math.min(RING.max, RING.base + RING.step * 3);
  for (const point of points) {
    assert.deepEqual(point.origin, { x: 760, y: 130 });
    const distance = Math.hypot(point.x - 760, point.y - 130);
    assert.ok(Math.abs(distance - radius) < 0.001, `${point.id} at ${distance}`);
  }

  // 四个点两两之间都要看得出来是四个点，不能挤成一条。
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const gap = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
      assert.ok(gap > 30, `${points[i].id}/${points[j].id} only ${gap} apart`);
    }
  }
});

test("no point sits straight above the anchor, where the hub arcs run", () => {
  for (const count of [2, 3, 4, 5, 7]) {
    const input = Array.from({ length: count }, (_, index) => at(400, 200, `p${index}`));
    const { points } = placePoints(input);
    for (const point of points) {
      const above = point.y < 200 && Math.abs(point.x - 400) < 0.001;
      assert.ok(!above, `${count} points: ${point.id} sits on the vertical axis`);
    }
  }
});

test("a coordinate repeated twice still separates, and both get a leader line", () => {
  const { points, spokes } = placePoints([at(300, 150, "a"), at(300, 150, "b")]);
  const gap = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
  assert.ok(gap > 30, `only ${gap} apart`);
  assert.ok(spokes.every((line) => line.x1 === 300 && line.y1 === 150));
});

test("nearby but distinct coordinates are not merged", () => {
  const { anchors } = placePoints([at(300, 150, "sg"), at(320, 150, "my")]);
  assert.deepEqual(anchors, []);
});

test("two distinct but close points are pushed apart, not stacked", () => {
  const { points } = placePoints([at(784.5, 164.8, "hk"), at(767.5, 181, "vn")]);
  const gap = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
  assert.ok(gap >= MIN_GAP - 0.001, `only ${gap} apart`);
  // 先到的点不动：位置以清单顺序先声明的那个为准。
  assert.deepEqual([points[0].x, points[0].y], [784.5, 164.8]);
});

test("leader lines end where the pin actually stopped", () => {
  const { points, spokes } = placePoints([
    at(784.5, 164.8, "hk"),
    at(767.5, 181, "vn"),
    at(760, 130.8, "cn"),
    at(760, 130.8, "cn2"),
  ]);
  for (const spoke of spokes) {
    const point = points.find((entry) => entry.id === spoke.id);
    assert.equal(spoke.x2, point.x);
    assert.equal(spoke.y2, point.y);
  }
});

test("a cluster near the edge stays on the canvas", () => {
  const top = placePoints([at(480, 2), at(480, 2), at(480, 2), at(480, 2)]);
  for (const point of top.points) {
    assert.ok(point.y >= 8 - 0.001, `y ${point.y}`);
    assert.ok(point.x >= 8 && point.x <= WORLD.width - 8);
  }

  const corner = placePoints([at(2, 2), at(2, 2), at(2, 2)]);
  for (const point of corner.points) {
    assert.ok(point.x >= 8 - 0.001 && point.y >= 8 - 0.001);
  }
});

test("placement is stable: same input, same output, whatever the clock says", () => {
  const input = [at(100, 100, "a"), at(100, 100, "b"), at(500, 200, "c"), at(100, 100, "d")];
  const first = placePoints(input);
  const second = placePoints(input.map((point) => ({ ...point })));

  assert.deepEqual(
    first.points.map((point) => [point.id, point.x, point.y]),
    second.points.map((point) => [point.id, point.x, point.y])
  );
  // 顺序就是角度：a 永远在同一个方向，加站不会让老的点转圈。
  assert.deepEqual(first.points.map((point) => point.id), ["a", "b", "d", "c"]);
});

test("points without a coordinate are dropped, not pinned at the origin", () => {
  const { points } = placePoints([{ id: "x", x: NaN, y: 10 }, { id: "y" }]);
  assert.deepEqual(points, []);
});
