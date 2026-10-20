import assert from "node:assert/strict";
import test from "node:test";

import {
  availableGroups,
  buildView,
  filterByGroup,
  sortInstances,
  summarize,
} from "./hub.js";

function instance(overrides = {}) {
  return {
    id: "travel-sg",
    name: { en: "Knot Travel SG", "zh-CN": "Knot 旅行 新加坡" },
    intro: { oneLine: { en: "Slow travel.", "zh-CN": "慢旅行。" } },
    tags: { en: ["travel"], "zh-CN": ["旅行"] },
    url: "https://travel.xknot.si",
    tier: "partner",
    status: "active",
    since: "2026-05-01",
    timezone: "Asia/Singapore",
    regions: ["SG"],
    health: { status: "up", lastOkAt: "2026-10-19T02:00:00.000Z", checkedAt: "2026-10-19T02:00:00.000Z" },
    ...overrides,
  };
}

test("the view resolves localized fields for the current locale", () => {
  const [item] = buildView({ instances: [instance()] }, { locale: "zh-CN" });
  assert.equal(item.name, "Knot 旅行 新加坡");
  assert.equal(item.intro, "慢旅行。");
  assert.deepEqual(item.tags, ["旅行"]);
});

test("zh-TW falls back to the other Chinese variant before English", () => {
  const [item] = buildView({ instances: [instance()] }, { locale: "zh-TW" });
  assert.equal(item.name, "Knot 旅行 新加坡");
});

test("a locale with no variant falls back to English", () => {
  const onlyEnglish = instance({ name: { en: "Knot Travel SG" } });
  const [item] = buildView({ instances: [onlyEnglish] }, { locale: "zh-TW" });
  assert.equal(item.name, "Knot Travel SG");
});

test("a missing health entry reads as unknown, not down", () => {
  const [item] = buildView({ instances: [instance({ health: null })] }, { locale: "en" });
  assert.equal(item.health.status, "unknown");
  assert.equal(item.health.lastOkAt, null);
});

test("a measured latency survives the view", () => {
  const [item] = buildView(
    { instances: [instance({ health: { status: "up", latencyMs: 128 } })] },
    { locale: "en" }
  );
  assert.equal(item.health.latencyMs, 128);
});

test("a probe without a latency stays null", () => {
  const [item] = buildView({ instances: [instance({ health: { status: "unknown" } })] }, { locale: "en" });
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
  const view = buildView(
    { instances: [instance({ id: "core", tier: "demo" }), instance({ id: "travel-sg" })] },
    { locale: "en" }
  );
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
    },
    { locale: "en" }
  );
  assert.deepEqual(
    view.map((item) => item.id),
    ["core"]
  );
  assert.equal(summarize(view).nodes, 1, "a hidden entry is not counted");
});

test("region groups are derived from country codes", () => {
  const [item] = buildView({ instances: [instance({ regions: ["SG", "MY"] })] }, { locale: "en" });
  assert.deepEqual(item.groups, ["southeast-asia"]);
});

test("the filter offers only groups that are actually used, in fixed order", () => {
  const view = buildView(
    {
      instances: [
        instance({ id: "eu", regions: ["SI"] }),
        instance({ id: "sg", regions: ["SG"] }),
        instance({ id: "global", regions: ["GLOBAL"] }),
      ],
    },
    { locale: "en" }
  );
  assert.deepEqual(availableGroups(view), ["global", "southeast-asia", "europe"]);
  assert.deepEqual(
    filterByGroup(view, "europe").map((item) => item.id),
    ["eu"]
  );
  assert.equal(filterByGroup(view, "all").length, 3);
});

test("an empty snapshot renders an empty list", () => {
  assert.deepEqual(buildView({ instances: [] }, { locale: "en" }), []);
  assert.deepEqual(buildView(null, { locale: "en" }), []);
});

test("cards reach the view, and an instance without cards gets an empty list", () => {
  const view = buildView(
    {
      instances: [
        instance({ id: "with", cards: [{ id: "c", title: "Note", url: "https://a.test/n" }] }),
        instance({ id: "without" }),
      ],
    },
    { locale: "en" }
  );
  assert.equal(view[0].cards[0].title, "Note");
  assert.deepEqual(view[1].cards, []);
});

test("summary counts nodes, regions and reachable nodes", () => {
  const view = buildView(
    {
      instances: [
        instance({ id: "a", regions: ["SG"], health: { status: "up" } }),
        instance({ id: "b", regions: ["SI"], health: { status: "degraded" } }),
        instance({ id: "c", regions: ["US"], health: { status: "down" } }),
        instance({ id: "d", regions: ["JP"], health: null }),
      ],
    },
    { locale: "en" }
  );
  assert.deepEqual(summarize(view, "2026-10-19T03:00:00.000Z"), {
    nodes: 4,
    regions: 4,
    healthy: 1,
    reachable: 2,
    generatedAt: "2026-10-19T03:00:00.000Z",
  });
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
