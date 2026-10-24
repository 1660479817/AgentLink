import assert from "node:assert/strict";
import test from "node:test";

import {
  availableGroups,
  availableTags,
  applyProbes,
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

// 区域以中枢观测到的出口 IP 为准：机器会搬，自述区的 region 是入网那天写的。
test("the observed country wins over the region the site declared", () => {
  const [item] = buildView(
    { instances: [instance({ region: "SG" })] },
    { locations: { "travel-sg": { country: "CN", at: "2026-10-22T01:00:00.000Z" } } }
  );
  assert.equal(item.region, "CN");
  assert.deepEqual(item.groups, ["east-asia"]);
  assert.deepEqual(item.located, { country: "CN", at: "2026-10-22T01:00:00.000Z", source: "tunnel" });
});

test("the whole /api/locations payload is accepted as is", () => {
  const [item] = buildView(
    { instances: [instance({ region: "SG" })] },
    { locations: { generatedAt: "2026-10-22T01:00:00.000Z", locations: { "travel-sg": { country: "CN" } } } }
  );
  assert.equal(item.region, "CN");
  assert.equal(item.located.country, "CN");
});

test("without an observation the declared region still shows, unmarked", () => {
  const [item] = buildView({ instances: [instance({ region: "SG" })] }, { locations: null });
  assert.equal(item.region, "SG");
  assert.deepEqual(item.groups, ["southeast-asia"]);
  assert.equal(item.located, null);
});

test("garbage in the location table is ignored, not printed", () => {
  for (const hit of [{ country: "China" }, { country: "ZZZ" }, { country: "" }, {}, null, "CN"]) {
    const [item] = buildView(
      { instances: [instance({ region: "SG" })] },
      { locations: { "travel-sg": hit } }
    );
    assert.equal(item.region, "SG");
    assert.equal(item.located, null);
  }
});

test("a lowercase code from an upstream feed is normalised", () => {
  const [item] = buildView(
    { instances: [instance({ region: "SG" })] },
    { locations: { "travel-sg": { country: "cn" } } }
  );
  assert.equal(item.region, "CN");
});

// 钟：主理人写下的永远优先；只在没写时按出口 IP 的国家推一个，并标出来。
test("a declared timezone is never replaced by the egress country", () => {
  const [item] = buildView(
    { instances: [instance({ timezone: "Asia/Singapore", region: "SG" })] },
    { locations: { "travel-sg": { country: "CN" } } }
  );
  assert.equal(item.timezone, "Asia/Singapore");
  assert.equal(item.timezoneInferred, false);
});

test("an undeclared timezone is guessed from the observed country", () => {
  const [item] = buildView(
    { instances: [instance({ timezone: null, region: "SG" })] },
    { locations: { "travel-sg": { country: "CN" } } }
  );
  assert.equal(item.timezone, "Asia/Shanghai");
  assert.equal(item.timezoneInferred, true);
});

test("with no timezone and no observation the clock stays UTC, unmarked", () => {
  const [item] = buildView({ instances: [instance({ timezone: null })] }, { locations: null });
  assert.equal(item.timezone, "UTC");
  assert.equal(item.timezoneInferred, false);
});

test("a country the table cannot place does not invent a clock", () => {
  const [item] = buildView(
    { instances: [instance({ timezone: null })] },
    { locations: { "travel-sg": { country: "ZZ" } } }
  );
  assert.equal(item.timezone, "UTC");
  assert.equal(item.timezoneInferred, false);
});

// 快照是构建那一刻的采样；页面上线后另取 /api/probes 换成当前状态。
test("a live probe replaces the state frozen in the snapshot", () => {
  const snapshot = {
    generatedAt: "2026-10-23T05:49:18.853Z",
    checkedAt: "2026-10-23T05:49:16.176Z",
    instances: [
      instance({
        id: "cpswang",
        health: {
          status: "down",
          latencyMs: 197,
          checkedAt: "2026-10-23T05:49:16.176Z",
          downSince: "2026-10-23T05:49:16.176Z",
          hidden: false,
        },
      }),
    ],
  };
  const live = {
    checkedAt: "2026-10-23T11:02:04.844Z",
    probes: {
      cpswang: {
        status: "up",
        latencyMs: 294,
        version: "0.6.0",
        lastOkAt: "2026-10-23T11:02:04.844Z",
        downSince: null,
        hidden: false,
      },
    },
  };

  const merged = applyProbes(snapshot, live);
  assert.equal(merged.checkedAt, "2026-10-23T11:02:04.844Z", "recent sync follows the probe");
  assert.equal(merged.generatedAt, snapshot.generatedAt, "the snapshot keeps its own build time");
  const [item] = buildView(merged);
  assert.equal(item.health.status, "up");
  assert.equal(item.health.latencyMs, 294);
  assert.equal(item.health.version, "0.6.0");
  assert.equal(item.health.lastOkAt, "2026-10-23T11:02:04.844Z");
  assert.equal(item.health.checkedAt, "2026-10-23T11:02:04.844Z");
});

test("a probe restores an entry that the snapshot had hidden", () => {
  const snapshot = { instances: [instance({ id: "a", health: { status: "down", hidden: true } })] };
  const merged = applyProbes(snapshot, {
    checkedAt: "2026-10-23T11:00:00.000Z",
    probes: { a: { status: "up", hidden: false } },
  });
  assert.deepEqual(
    buildView(merged).map((item) => item.id),
    ["a"]
  );
});

test("entries the live probe does not know keep the snapshot value", () => {
  const snapshot = { instances: [instance({ id: "a", health: { status: "up", latencyMs: 90 } }), instance({ id: "b" })] };
  const merged = applyProbes(snapshot, { checkedAt: "2026-10-23T11:00:00.000Z", probes: { a: { status: "degraded" } } });
  assert.equal(merged.instances[1], snapshot.instances[1]);
  assert.equal(merged.instances[0].health.status, "degraded");
});

test("a probe entry the snapshot does not list is not added", () => {
  const snapshot = { instances: [instance({ id: "a" })] };
  const merged = applyProbes(snapshot, { probes: { ghost: { status: "up" } } });
  assert.deepEqual(
    merged.instances.map((item) => item.id),
    ["a"]
  );
});

test("without a probe table the data is left as it is", () => {
  const snapshot = { instances: [instance({ health: { status: "down" } })] };
  assert.equal(applyProbes(snapshot, null), snapshot);
  assert.equal(applyProbes(snapshot, {}), snapshot);
  assert.equal(applyProbes(snapshot, []), snapshot);
});
