import assert from "node:assert/strict";
import test from "node:test";
import { compareByWeight, pickCitations, presentDemand } from "./market.js";
import { packetPrice } from "./points.js";

const WHEN = "2026-10-12T02:00:00.000Z";

function demand(overrides) {
  return {
    id: "demand-1",
    brief: "找价格",
    citation_limit: 10,
    status: "open",
    created_at: WHEN,
    stopped_at: null,
    stop_reason: null,
    attachments: [],
    deliveries: [],
    ...overrides,
  };
}

test("an open demand with no delivery is still working", () => {
  const presented = presentDemand(demand({}));
  assert.deepEqual(presented.replies, [{ kind: "system", code: "working", createdAt: WHEN }]);
});

test("a finished empty delivery is empty while the demand stays open", () => {
  const presented = presentDemand(
    demand({
      deliveries: [
        {
          id: "delivery-1",
          body: "没有找到相关内容。",
          citationCount: 0,
          cost: 0,
          createdAt: WHEN,
          cards: [],
        },
      ],
    })
  );
  assert.equal(presented.status, "open");
  assert.deepEqual(presented.replies, [{ kind: "system", code: "empty", createdAt: WHEN }]);
});

test("stopping after an empty delivery keeps both facts", () => {
  const presented = presentDemand(
    demand({
      status: "stopped",
      stopped_at: WHEN,
      stop_reason: "user",
      deliveries: [
        {
          id: "delivery-1",
          body: "没有找到相关内容。",
          citationCount: 0,
          cost: 0,
          createdAt: WHEN,
          cards: [],
        },
      ],
    })
  );
  assert.deepEqual(
    presented.replies.map((reply) => reply.code),
    ["empty", "stopped"]
  );
});

test("a cited card keeps its star", () => {
  const presented = presentDemand(
    demand({
      deliveries: [
        {
          id: "delivery-1",
          body: "1. 事实",
          citationCount: 1,
          cost: 1,
          createdAt: WHEN,
          cards: [{ id: "intel-1", body: "事实", images: [], attachments: [], starred: true }],
        },
      ],
    })
  );
  const card = presented.replies.find((reply) => reply.kind === "delivery");
  assert.equal(card.starrable, true);
  assert.equal(card.starred, true);
  assert.equal(card.id, "intel-1");
});

test("feed order is weight, then newer", () => {
  const rows = [
    { weight: 1, created_at: "2026-10-12T00:00:00.000Z", id: "older" },
    { weight: 2, created_at: "2026-10-01T00:00:00.000Z", id: "heavier" },
    { weight: 1, created_at: "2026-10-12T03:00:00.000Z", id: "newer" },
  ];
  assert.deepEqual(rows.sort(compareByWeight).map((row) => row.id), ["heavier", "newer", "older"]);
});

test("text packets are free and a blank attachment price uses the default", () => {
  assert.equal(packetPrice(0, 25), 0);
  assert.equal(packetPrice(1, ""), 10);
  assert.equal(packetPrice(1, null), 10);
  assert.equal(packetPrice(2, 0), 0);
  assert.equal(packetPrice(2, 8), 8);
});

test("citation ids match inventory regardless of case", () => {
  const id = "23737bf5-537f-441f-bc86-bf230d1cf9ed";
  const chosen = pickCitations([id.toUpperCase()], [{ id, text: "一条情报" }], 10);
  assert.deepEqual(chosen, [{ id, text: "一条情报" }]);
});
