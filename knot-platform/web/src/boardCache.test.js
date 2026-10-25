import assert from "node:assert/strict";
import { test } from "node:test";
import { BOARD_CACHE_KEY, BOARD_CACHE_MAX_AGE_MS, cachedBrand, cachedSite, clearBoardCache, readBoardCache, writeBoardCache } from "./boardCache.js";

function storage(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

const board = {
  version: "2026-10-22T00:00:00.000Z",
  site: { guestBrowsing: true, registrationMode: "open", publicBoard: true },
  brand: { name: "王的站点", tagline: "收二手，也收问题。", logo: "", owner: null, intro: null, contact: "" },
  locale: "zh-CN",
  information: [{ id: "p1" }],
  people: [{ id: "me" }],
  facets: { categories: [], topics: [] },
};

test("写进去的快照原样读回来", () => {
  const box = storage();
  assert.equal(writeBoardCache(box, board, 1000), true);
  const saved = readBoardCache(box, 1000 + 1000);
  assert.deepEqual(saved.information, board.information);
  assert.equal(saved.site.publicBoard, true);
});

test("超过一天就不再使用：旧板不能一直画", () => {
  const box = storage();
  writeBoardCache(box, board, 1000);
  assert.equal(readBoardCache(box, 1000 + BOARD_CACHE_MAX_AGE_MS + 1), null);
});

test("坏掉的 JSON 或形状不对的快照当作没有", () => {
  assert.equal(readBoardCache(storage({ [BOARD_CACHE_KEY]: "not json" })), null);
  assert.equal(readBoardCache(storage({ [BOARD_CACHE_KEY]: JSON.stringify({ savedAt: 1, board: { information: [] } }) })), null);
  assert.equal(readBoardCache(storage()), null);
});

test("没有 people 这一项时补成空数组，页面不用再判一次", () => {
  const box = storage();
  const { people, ...withoutPeople } = board;
  writeBoardCache(box, withoutPeople, 1000);
  assert.deepEqual(readBoardCache(box, 1000).people, []);
});

test("站点开关缺失时按放行处理，但明确关掉时不放行", () => {
  assert.deepEqual(cachedSite({}), null);
  assert.deepEqual(cachedSite({ site: { guestBrowsing: false, publicBoard: false } }), {
    guestBrowsing: false,
    registrationMode: "open",
    publicBoard: false,
  });
  assert.equal(cachedSite({ site: {} }).guestBrowsing, true);
});

test("站点身份缺失时返回 null，由 store 用默认值", () => {
  assert.equal(cachedBrand({}), null);
  assert.equal(cachedBrand({ brand: { name: "甲" } }).name, "甲");
});

test("存储不可用时不抛异常", () => {
  const broken = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("quota");
    },
    removeItem() {
      throw new Error("blocked");
    },
  };
  assert.equal(readBoardCache(broken), null);
  assert.equal(writeBoardCache(broken, board), false);
  assert.doesNotThrow(() => clearBoardCache(broken));
});
