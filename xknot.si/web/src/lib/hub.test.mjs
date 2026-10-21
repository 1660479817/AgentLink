import assert from "node:assert/strict";
import test from "node:test";

import {
  availableGroups,
  availableTags,
  buildView,
  filterByGroup,
  filterByTag,
  sortInstances,
  summarize,
} from "./hub.js";

function instance(overrides = {}) {
  return {
    id: "travel-sg",
    name: "Knot 旅行 新加坡",
    tagline: "慢旅行。",
    intro: "只写走过的地方。",
    owner: "Mei",
    contact: "mei@example.test",
    tags: ["旅行", "东南亚"],
    url: "https://travel.xknot.si",
    tier: "partner",
    status: "active",
    since: "2026-05-01",
    timezone: "Asia/Singapore",
    region: "SG",
    health: { status: "up", lastOkAt: "2026-10-19T02:00:00.000Z", checkedAt: "2026-10-19T02:00:00.000Z" },
    ...overrides,
  };
}

test("the view passes the owner's own strings through, in whatever language they wrote", () => {
  const [item] = buildView({ instances: [instance()] });
  assert.equal(item.name, "Knot 旅行 新加坡");
  assert.equal(item.tagline, "慢旅行。");
  assert.equal(item.intro, "只写走过的地方。");
  assert.equal(item.owner, "Mei");
  assert.deepEqual(item.tags, ["旅行", "东南亚"]);
});

test("a view without a name falls back to the id rather than rendering blank", () => {
  const [item] = buildView({ instances: [instance({ name: null })] });
  assert.equal(item.name, "travel-sg");
});

test("a view without tags gets an empty list, not the raw field", () => {
  const [item] = buildView({ instances: [instance({ tags: null })] });
  assert.deepEqual(item.tags, []);
});

test("a missing health entry reads as unknown, not down", () => {
  const [item] = buildView({ instances: [instance({ health: null })] });
  assert.equal(item.health.status, "unknown");
  assert.equal(item.health.lastOkAt, null);
});

test("a measured latency survives the view", () => {
  const [item] = buildView({ instances: [instance({ health: { status: "up", latencyMs: 128 } })] });
  assert.equal(item.health.latencyMs, 128);
});

test("a probe without a latency stays null", () => {
  const [item] = buildView({ instances: [instance({ health: { status: "unknown" } })] });
  assert.equal(item.health.latencyMs, null);
});

test("order is tier, then since, then id", () => {
  const list = [
    instance({ id: "b", tier: "community", since: "2026-01-01" }),
    instance({ id: "a", tier: "partner", since: "2026-02-01" }),
    instance({ id: "core", tier: "demo", since: "2026-10-19" }),
    instance({ id: "c", tier: "partner", since: "2026-01-01" }),
  ];
  assert.deepEqual(
    sortInstances(list).map((item) => item.id),
    ["core", "c", "a", "b"]
  );
});

test("demo entries stay in the list", () => {
  const view = buildView({ instances: [instance({ id: "core", tier: "demo" }), instance({ id: "travel-sg" })] });
  assert.deepEqual(
    view.map((item) => item.id),
    ["core", "travel-sg"]
  );
});

test("an entry hidden by the health policy drops out of the view", () => {
  const view = buildView(
    {
      instances: [
        instance({ id: "core", tier: "demo" }),
        instance({ id: "hidden", health: { status: "down", hidden: true } }),
      ],
    }
  );
  assert.deepEqual(
    view.map((item) => item.id),
    ["core"]
  );
  assert.equal(summarize(view).nodes, 1, "a hidden entry is not counted");
});

test("the region group is derived from the one country code", () => {
  const [item] = buildView({ instances: [instance({ region: "SG" })] });
  assert.deepEqual(item.groups, ["southeast-asia"]);
});

test("an unknown country code falls into 「其他」, not into a guess", () => {
  const [item] = buildView({ instances: [instance({ region: "XX" })] });
  assert.deepEqual(item.groups, ["other"]);
});

test("the filter offers only groups that are actually used, in fixed order", () => {
  const view = buildView({
    instances: [
      instance({ id: "eu", region: "SI" }),
      instance({ id: "sg", region: "SG" }),
      instance({ id: "global", region: "GLOBAL" }),
    ],
  });
  assert.deepEqual(availableGroups(view), ["global", "southeast-asia", "europe"]);
  assert.deepEqual(
    filterByGroup(view, "europe").map((item) => item.id),
    ["eu"]
  );
  assert.equal(filterByGroup(view, "all").length, 3);
});

test("an empty snapshot renders an empty list", () => {
  assert.deepEqual(buildView({ instances: [] }), []);
  assert.deepEqual(buildView(null), []);
});

test("cards reach the view, and an instance without cards gets an empty list", () => {
  const view = buildView(
    {
      instances: [
        instance({ id: "with", cards: [{ id: "c", title: "Note", url: "https://a.test/n" }] }),
        instance({ id: "without" }),
      ],
    }
  );
  assert.equal(view[0].cards[0].title, "Note");
  assert.deepEqual(view[1].cards, []);
});

test("summary counts nodes, regions and reachable nodes", () => {
  const view = buildView(
    {
      instances: [
        instance({ id: "a", region: "SG", health: { status: "up" } }),
        instance({ id: "b", region: "SI", health: { status: "degraded" } }),
        instance({ id: "c", region: "US", health: { status: "down" } }),
        instance({ id: "d", region: "JP", health: null }),
      ],
    }
  );
  assert.deepEqual(summarize(view, "2026-10-19T03:00:00.000Z"), {
    nodes: 4,
    regions: 4,
    healthy: 1,
    reachable: 2,
    generatedAt: "2026-10-19T03:00:00.000Z",
  });
});

test("tag filter uses the owner's literal strings and keeps first-seen order", () => {
  const view = buildView({
    instances: [
      instance({ id: "a", tags: ["旅行", "Agent"] }),
      instance({ id: "b", tags: ["Agent"] }),
      instance({ id: "c", tags: [] }),
    ],
  });
  assert.deepEqual(availableTags(view), ["旅行", "Agent"]);
  assert.deepEqual(filterByTag(view, "Agent").map((item) => item.id), ["a", "b"]);
  assert.deepEqual(filterByTag(view, "旅行").map((item) => item.id), ["a"]);
  assert.equal(filterByTag(view, "").length, 3);
});

test("summary of an empty view is all zeros", () => {
  assert.deepEqual(summarize([], null), {
    nodes: 0,
    regions: 0,
    healthy: 0,
    reachable: 0,
    generatedAt: null,
  });
});
