import assert from "node:assert/strict";
import test from "node:test";

import { centroidOf, COUNTRY_AT, project, WORLD } from "./world.js";

test("the map canvas keeps a 360° by 142° frame", () => {
  const ratio = WORLD.width / WORLD.height;
  const expected = 360 / (WORLD.latMax - WORLD.latMin);
  assert.ok(Math.abs(ratio - expected) < 0.005, `${ratio} vs ${expected}`);
  assert.equal(project(-180, WORLD.latMax).x, 0);
  assert.equal(project(180, WORLD.latMax).x, WORLD.width);
});

test("projection clamps latitudes outside the frame instead of going negative", () => {
  assert.equal(project(0, 89).y, 0);
  assert.equal(project(0, -89).y, WORLD.height);
  assert.equal(project(0, 0).y, (WORLD.latMax / (WORLD.latMax - WORLD.latMin)) * WORLD.height);
});

test("a node with no coordinate is dropped rather than pinned at 0,0", () => {
  assert.equal(project(null, 10), null);
  assert.equal(project(NaN, 10), null);
  assert.equal(centroidOf(["GLOBAL"]), null);
  assert.equal(centroidOf([]), null);
});

test("multi-country coverage averages across the globe without a seam", () => {
  const iberia = centroidOf(["ES", "PT"]);
  assert.ok(iberia.lon > -9 && iberia.lon < -3, `lon ${iberia.lon}`);
  assert.ok(iberia.lat > 36 && iberia.lat < 43, `lat ${iberia.lat}`);

  // 新西兰与萨摩亚分列 180° 两侧，取平均应落在太平洋，不能跳到 0°。
  const pacific = centroidOf(["NZ", "WS"]);
  assert.ok(pacific.lon < -160 || pacific.lon > 160, `lon ${pacific.lon}`);
});

test("every country code used by the group table has a coordinate", () => {
  for (const code of ["CN", "JP", "SG", "IN", "AE", "SE", "GB", "US", "AR", "MA", "AU", "NZ"]) {
    assert.ok(COUNTRY_AT[code], code);
  }
});
