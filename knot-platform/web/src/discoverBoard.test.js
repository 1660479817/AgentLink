import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { applyDiscoverSelf, boardIsBehind, cardBought, cardIsMine, coveredBy, emptyFacets, facetsOf, hideDiscoverItem, paintDiscover, rememberAhead, rememberDiscover, showDiscoverItem } from "./discoverBoard.js";

beforeEach(() => {
  showDiscoverItem("11111111-1111-4111-8111-111111111111");
  showDiscoverItem("55555555-5555-4555-8555-555555555555");
  rememberAhead(null);
  rememberDiscover(null);
});

const ME = "33333333-3333-4333-8333-333333333333";
const POST = "11111111-1111-4111-8111-111111111111";
const FRESH = "55555555-5555-4555-8555-555555555555";

test("the painted board is only the public feed", () => {
  const painted = paintDiscover({ information: [{ id: POST, canFriend: true }] });
  assert.deepEqual(painted.information.map((item) => item.id), [POST]);
  // 快照里仍带着 requests 字段（中枢契约不改），但货架不在信息流里。
  assert.equal("requests" in painted, false);
  assert.equal(cardIsMine(painted.information[0], { id: ME }), false);
});

test("the personal patch hides, stars, likes, and friends only after it arrives", () => {
  const painted = paintDiscover({
    information: [
      { id: POST, personal: false },
      { id: FRESH, personal: false },
    ],
  });
  const next = applyDiscoverSelf(painted, {
    dismissed: [FRESH],
    starred: [POST],
    liked: [POST],
    friends: [POST],
    mine: [],
  });
  assert.deepEqual(next.information.map((item) => item.id), [POST]);
  assert.equal(next.information[0].personal, true);
  assert.equal(next.information[0].starred, true);
  assert.equal(next.information[0].liked, true);
  assert.equal(next.information[0].friend, true);
  assert.equal(next.information[0].canFriend, true);
  assert.equal(cardIsMine(next.information[0], { id: ME }), false);
});

test("a card is mine only after the personal patch says so", () => {
  assert.equal(cardIsMine({ personal: true, mine: true, canFriend: false }, { id: ME }), true);
  assert.equal(cardIsMine({ canFriend: false }, { id: ME }), true);
  assert.equal(cardIsMine({ canFriend: false }, null), false);
});

// 帖子附件免费取，所以「买过没有」只对商品有意义。
test("a bought mark comes from the order, or from being the seller", () => {
  assert.equal(cardBought({ store: { bought: true } }, { id: ME }), true);
  assert.equal(cardBought({ store: { bought: false, mine: true } }, { id: ME }), true);
  assert.equal(cardBought({ store: { bought: false } }, { id: ME }), false);
  assert.equal(cardBought({}, { id: ME }), false);
});

test("the people rail rides along with the snapshot", () => {
  const painted = paintDiscover({
    information: [],
    people: [{ id: ME, name: "甲", avatarUrl: "/avatars/01.svg", role: "user" }],
  });
  assert.equal(painted.people[0].id, ME);
  const next = applyDiscoverSelf(painted, {});
  assert.equal(next.people.length, 1);
  assert.equal(next.people[0].name, "甲");
  // role 也要一路带到卡片上：徽标靠它分人与 Agent，别在个人状态那一步丢掉。
  assert.equal(next.people[0].role, "user");
});

test("facets ride along with the snapshot and survive the personal patch", () => {
  const facets = { categories: ["招聘"], topics: ["大模型"] };
  const painted = paintDiscover({ information: [], facets });
  assert.deepEqual(painted.facets, facets);
  const next = applyDiscoverSelf(painted, {});
  assert.deepEqual(next.facets, facets);
});

test("a snapshot without facets falls back to empty lists", () => {
  assert.deepEqual(facetsOf({}), emptyFacets());
  assert.deepEqual(facetsOf({ facets: { categories: ["a"], topics: null } }), { categories: ["a"], topics: [] });
});

test("a locally hidden card stays hidden, and a new post waits for the snapshot", () => {
  rememberDiscover({ information: [{ id: POST }] });
  hideDiscoverItem(POST);
  const painted = paintDiscover({ information: [{ id: POST }, { id: FRESH }] });
  assert.deepEqual(painted.information.map((item) => item.id), [FRESH]);
  showDiscoverItem(POST);
  rememberAhead({ information: [{ id: POST }, { id: FRESH }] });
  assert.equal(coveredBy({ information: [{ id: POST }] }), false);
  assert.equal(coveredBy({ information: [{ id: POST }, { id: FRESH }] }), true);
  rememberAhead(null);
  rememberDiscover(null);
});

test("the painted snapshot is only behind when the instance's version is newer", () => {
  // 入口磁盘上那份由中枢按间隔取回，可能晚一个间隔。会话响应带回实例侧版本，
  // 只有它更新时才回源，所以正常打开不会多一次往返。
  const painted = { version: "2026-10-25T00:00:00.000Z" };
  assert.equal(boardIsBehind(painted, "2026-10-25T00:00:00.000Z"), false);
  assert.equal(boardIsBehind(painted, "2026-10-25T00:00:20.000Z"), true);
  assert.equal(boardIsBehind(painted, "2026-10-24T23:59:40.000Z"), false);
});

test("without a version on either side nothing is treated as stale", () => {
  // 关掉公开快照、接口没回话、或者站点还是老版本：没有依据就不要回源。
  assert.equal(boardIsBehind({}, "2026-10-25T00:00:00.000Z"), false);
  assert.equal(boardIsBehind({ version: "2026-10-25T00:00:00.000Z" }, null), false);
  assert.equal(boardIsBehind({ version: "not a date" }, "2026-10-25T00:00:00.000Z"), false);
  assert.equal(boardIsBehind(null, "2026-10-25T00:00:00.000Z"), false);
});
