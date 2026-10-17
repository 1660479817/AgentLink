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
  const facets = facetRows(rows);
  assert.deepEqual(facets.categories, ["招聘", "房产"]);
  assert.deepEqual(facets.topics, ["大模型", "租房", "算法"]);
});

test("empty rows yield empty facets", () => {
  assert.deepEqual(facetRows([]), { categories: [], topics: [] });
});
