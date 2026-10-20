import assert from "node:assert/strict";
import test from "node:test";

import { buildHubData } from "./snapshot.js";

const MANIFEST = {
  instances: [
    {
      id: "legacy",
      name: { en: "Knot" },
      url: "https://legacy.example.com",
      redirect: "https://knot.zenheart.net",
      languages: ["en", "zh-CN"],
      regions: ["GLOBAL"],
      timezone: "Asia/Shanghai",
      intro: { oneLine: { en: "An information exchange network." } },
      tier: "demo",
      status: "active",
      since: "2026-10-19",
      healthUrl: "https://legacy.example.com/api/health",
    },
  ],
};

const HEALTH = {
  checkedAt: "2026-10-19T02:30:00.000Z",
  instances: {
    legacy: { status: "up", lastOkAt: "2026-10-19T02:30:00.000Z", latencyMs: 137, version: "0.2.0" },
  },
};

test("the snapshot carries manifest fields plus the probe result", () => {
  const data = buildHubData(MANIFEST, HEALTH, new Date("2026-10-19T03:00:00Z"));
  assert.equal(data.generatedAt, "2026-10-19T03:00:00.000Z");
  assert.equal(data.checkedAt, "2026-10-19T02:30:00.000Z");

  const [legacy] = data.instances;
  assert.equal(legacy.id, "legacy");
  assert.equal(legacy.name.en, "Knot");
  assert.equal(legacy.redirect, "https://knot.zenheart.net");
  assert.deepEqual(legacy.regions, ["GLOBAL"]);
  assert.deepEqual(legacy.health, {
    status: "up",
    lastOkAt: "2026-10-19T02:30:00.000Z",
    latencyMs: 137,
    version: "0.2.0",
    checkedAt: "2026-10-19T02:30:00.000Z",
    downSince: null,
    hidden: false,
  });
});

test("an instance without a probe result keeps health null", () => {
  const data = buildHubData(MANIFEST, { instances: {} });
  assert.equal(data.instances[0].health, null);
});

test("a hidden probe result keeps the entry in the snapshot but marks it hidden", () => {
  // 清单不动，只把隐藏标记带进快照；过滤发生在页面视图。
  const data = buildHubData(MANIFEST, {
    checkedAt: "2026-10-19T02:30:00.000Z",
    instances: {
      legacy: {
        status: "down",
        downSince: "2026-10-11T00:00:00.000Z",
        hiddenAt: "2026-10-18T00:00:00.000Z",
        hiddenReason: "down_7d",
      },
    },
  });
  assert.equal(data.instances.length, 1);
  assert.equal(data.instances[0].health.hidden, true);
  assert.equal(data.instances[0].health.downSince, "2026-10-11T00:00:00.000Z");
});

test("optional fields get stable placeholders", () => {
  const data = buildHubData({ instances: [{ id: "x", name: { en: "X" }, url: "https://x.test" }] }, {});
  const [item] = data.instances;
  assert.deepEqual(item.languages, []);
  assert.deepEqual(item.regions, []);
  assert.equal(item.timezone, "UTC");
  assert.equal(item.health, null);
});

test("an empty or missing manifest yields an empty snapshot", () => {
  assert.deepEqual(buildHubData({}, {}).instances, []);
  assert.deepEqual(buildHubData(null, null).instances, []);
});

test("cards come from var/cards by instance id", () => {
  const data = buildHubData(
    { instances: [{ id: "a", name: { en: "A" }, url: "https://a.test" }, { id: "b", name: { en: "B" }, url: "https://b.test" }] },
    {},
    new Date("2026-10-19T08:00:00Z"),
    {
      a: {
        generatedAt: "2026-10-19T06:00:00.000Z",
        cards: [{ title: "Note", url: "https://a.test/n", lang: "en" }],
      },
    }
  );
  assert.equal(data.instances[0].cards[0].title, "Note");
  assert.deepEqual(data.instances[1].cards, []);
});

test("stats come from var/stats, and a missing file reads as null", () => {
  const data = buildHubData(
    { instances: [{ id: "a", name: { en: "A" }, url: "https://a.test" }, { id: "b", name: { en: "B" }, url: "https://b.test" }] },
    {},
    new Date("2026-10-19T08:00:00Z"),
    {},
    {
      a: {
        generatedAt: "2026-10-19T06:00:00.000Z",
        fetchedAt: "2026-10-19T07:00:00.000Z",
        stats: { posts: { total: 12, last24h: 3 }, accounts: { total: 4 } },
      },
    }
  );
  assert.deepEqual(data.instances[0].stats.posts, { total: 12, last24h: 3 });
  assert.equal(data.instances[1].stats, null);
});

test("logo paths resolve from the site root", () => {
  const data = buildHubData(
    {
      instances: [
        { id: "a", name: { en: "A" }, url: "https://a.test", logo: "logos/a.svg" },
        { id: "b", name: { en: "B" }, url: "https://b.test", logo: "/logos/b.svg" },
        { id: "c", name: { en: "C" }, url: "https://c.test", logo: "https://cdn.test/c.png" },
        { id: "d", name: { en: "D" }, url: "https://d.test" },
      ],
    },
    {}
  );
  assert.deepEqual(
    data.instances.map((item) => item.logo),
    ["/logos/a.svg", "/logos/b.svg", "https://cdn.test/c.png", null]
  );
});
