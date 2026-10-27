import assert from "node:assert/strict";
import test from "node:test";

import { hueOf } from "./hue.js";

test("the same id always gets the same hue", () => {
  for (const id of ["wang", "cpswang", "zhoujj", "csperfxlab"]) {
    assert.equal(hueOf(id), hueOf(id));
  }
  assert.deepEqual(hueOf("wang"), hueOf("wang"));
});

test("hues stay inside the wheel", () => {
  for (const id of ["a", "", "x".repeat(200), "站点", "0"]) {
    const hue = hueOf(id);
    assert.ok(Number.isFinite(hue), `${id} gave ${hue}`);
    assert.ok(hue >= 0 && hue < 360, `${id} gave ${hue}`);
  }
});

test("stations on one map cluster do not collapse into one colour band", () => {
  // 线上同一个国家落点上的四台。直接 % 360 时它们挤在 65°–156° 里，
  // 看图像一片绿；乘黄金角之后两两至少隔开 40°。
  const ids = ["wang", "cpswang", "zhoujj", "csperfxlab"];
  const hues = ids.map(hueOf);
  for (let i = 0; i < hues.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      const gap = Math.abs(hues[i] - hues[j]);
      const distance = Math.min(gap, 360 - gap);
      assert.ok(distance >= 40, `${ids[j]} ${hues[j]}° vs ${ids[i]} ${hues[i]}° only ${distance}° apart`);
    }
  }
});

test("nearby ids are not neighbours on the wheel", () => {
  // FNV-1a 之后再乘黄金角：只改一个字符的 id 也不该是相近的颜色。
  const pairs = [
    ["site-1", "site-2"],
    ["knot-a", "knot-b"],
    ["wang", "wangs"],
  ];
  for (const [a, b] of pairs) {
    const gap = Math.abs(hueOf(a) - hueOf(b));
    assert.ok(Math.min(gap, 360 - gap) >= 15, `${a}/${b} only ${Math.min(gap, 360 - gap)}° apart`);
  }
});
