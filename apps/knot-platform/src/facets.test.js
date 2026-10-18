import assert from "node:assert/strict";
import test from "node:test";
import { facetRows } from "./facets.js";

test("facets count categories and topics and order them by frequency", () => {
  const rows = [
    { category: "招聘", detail: { topics: ["大模型", "算法"] } },
    { category: "招聘", detail: { topics: ["大模型"] } },
    { category: "房产", detail: { topics: ["租房"] } },
    { category: "", detail: { topics: [] } },
    { category: "  招聘  ", detail: null },
  ];
  const facets = facetRows(rows, { categoryMin: 1, topicMin: 1 });
  assert.deepEqual(facets.categories, ["招聘", "房产"]);
  assert.deepEqual(facets.topics, ["大模型", "租房", "算法"]);
});

test("the dynamic threshold keeps long-tail topics that a fixed floor would drop", () => {
  // 频次 [5, 2, 1]，中位数 2：5 和 2 都保留，只有出现一次的宠物被滤掉。
  // 旧逻辑的 CATEGORY_MIN=5 会把「汽车」(2 次) 也砍掉。
  const rows = [
    { category: "科技", detail: { topics: [] } },
    { category: "科技", detail: { topics: [] } },
    { category: "科技", detail: { topics: [] } },
    { category: "科技", detail: { topics: [] } },
    { category: "科技", detail: { topics: [] } },
    { category: "汽车", detail: { topics: [] } },
    { category: "汽车", detail: { topics: [] } },
    { category: "宠物", detail: { topics: [] } },
  ];
  const facets = facetRows(rows);
  assert.deepEqual(facets.categories, ["科技", "汽车"]);
  assert.deepEqual(facets.topics, []);
});

test("cold start keeps everything when every count ties", () => {
  // 全是 1 频次：中位数 1，全列，长尾不消失。
  const rows = [
    { category: "科技", detail: { topics: ["大模型"] } },
    { category: "汽车", detail: { topics: ["智驾"] } },
    { category: "宠物", detail: { topics: ["猫"] } },
  ];
  const facets = facetRows(rows);
  assert.deepEqual(facets.categories, ["宠物", "汽车", "科技"]);
  assert.deepEqual(facets.topics, ["大模型", "智驾", "猫"]);
});

test("an explicit floor still overrides the dynamic threshold", () => {
  const rows = [
    { category: "科技", detail: { topics: ["大模型"] } },
    { category: "科技", detail: { topics: ["大模型"] } },
    { category: "科技", detail: { topics: ["租房"] } },
  ];
  const facets = facetRows(rows, { categoryMin: 1, topicMin: 2 });
  assert.deepEqual(facets.categories, ["科技"]);
  assert.deepEqual(facets.topics, ["大模型"]);
});

test("empty rows yield empty facets", () => {
  assert.deepEqual(facetRows([]), { categories: [], topics: [] });
});
