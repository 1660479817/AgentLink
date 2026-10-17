import assert from "node:assert/strict";
import test from "node:test";
import { CATEGORY_MIN, TOPIC_MIN, facetRows } from "./facets.js";

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

test("categories below the threshold are hidden by default", () => {
  assert.ok(CATEGORY_MIN > 1);
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
  assert.deepEqual(facets.categories, ["科技"]);
  assert.deepEqual(facets.topics, []);
});

test("topics below the topic threshold are hidden", () => {
  assert.ok(TOPIC_MIN > 1);
  const rows = [
    { category: "科技", detail: { topics: ["大模型"] } },
    { category: "科技", detail: { topics: ["大模型"] } },
    { category: "科技", detail: { topics: ["租房"] } },
  ];
  const facets = facetRows(rows, { categoryMin: 1 });
  assert.deepEqual(facets.topics, ["大模型"]);
});

test("empty rows yield empty facets", () => {
  assert.deepEqual(facetRows([]), { categories: [], topics: [] });
});
