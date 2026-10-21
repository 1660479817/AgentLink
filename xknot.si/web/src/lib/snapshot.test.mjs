import assert from "node:assert/strict";
import test from "node:test";

import { buildHubData } from "./snapshot.js";

// 登记表只有签发区；名称、介绍这些来自 var/profiles 里的副本。
const MANIFEST = {
  instances: [
    {
      id: "legacy",
      url: "https://legacy.example.com",
      tier: "demo",
      status: "active",
      since: "2026-10-19",
    },
  ],
};

const PROFILES = {
  legacy: {
    formatVersion: 1,
    fetchedAt: "2026-10-19T02:00:00.000Z",
    issued: { id: "legacy", url: "https://legacy.example.com", since: "2026-10-19", tier: "demo", status: "active" },
    profile: {
      name: { en: "Knot" },
      languages: ["en", "zh-CN"],
      regions: ["GLOBAL"],
      timezone: "Asia/Shanghai",
      contact: "hi@legacy.example.com",
      intro: { oneLine: { en: "An information exchange network." } },
    },
  },
};

const HEALTH = {
  checkedAt: "2026-10-19T02:30:00.000Z",
  instances: {
    legacy: { status: "up", lastOkAt: "2026-10-19T02:30:00.000Z", latencyMs: 137, version: "0.2.0" },
  },
};

test("the snapshot merges issued fields, the cached profile and the probe result", () => {
  const data = buildHubData(MANIFEST, HEALTH, new Date("2026-10-19T03:00:00Z"), {}, {}, PROFILES);
  assert.equal(data.generatedAt, "2026-10-19T03:00:00.000Z");
  assert.equal(data.checkedAt, "2026-10-19T02:30:00.000Z");

  const [legacy] = data.instances;
  assert.equal(legacy.id, "legacy");
  assert.equal(legacy.name.en, "Knot");
  assert.equal(legacy.url, "https://legacy.example.com");
  assert.deepEqual(legacy.regions, ["GLOBAL"]);
  assert.equal(legacy.contact, "hi@legacy.example.com");
  assert.equal(legacy.profileFetchedAt, "2026-10-19T02:00:00.000Z");
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

test("a site that has never been fetched still renders, using its id as the name", () => {
  const data = buildHubData(MANIFEST, {}, new Date("2026-10-19T03:00:00Z"));
  const [legacy] = data.instances;
  assert.deepEqual(legacy.name, { en: "legacy", "zh-CN": "legacy", "zh-TW": "legacy" });
  assert.equal(legacy.profileFetchedAt, null);
  assert.equal(legacy.intro, null);
});

test("pending entries stay in the manifest but not in the public snapshot", () => {
  const data = buildHubData(
    {
      instances: [
        { id: "done", url: "https://done.test", status: "active" },
        { id: "waiting", url: "https://waiting.test", status: "pending" },
      ],
    },
    {}
  );
  assert.deepEqual(
    data.instances.map((item) => item.id),
    ["done"]
  );
});

test("an instance without a probe result keeps health null", () => {
  const data = buildHubData(MANIFEST, { instances: {} }, undefined, {}, {}, PROFILES);
  assert.equal(data.instances[0].health, null);
});

test("a hidden probe result keeps the entry in the snapshot but marks it hidden", () => {
  // 登记表不动，只把隐藏标记带进快照；过滤发生在页面视图。
  const data = buildHubData(
    MANIFEST,
    {
      checkedAt: "2026-10-19T02:30:00.000Z",
      instances: {
        legacy: {
          status: "down",
          downSince: "2026-10-11T00:00:00.000Z",
          hiddenAt: "2026-10-18T00:00:00.000Z",
          hiddenReason: "down_7d",
        },
      },
    },
    undefined,
    {},
    {},
    PROFILES
  );
  assert.equal(data.instances.length, 1);
  assert.equal(data.instances[0].health.hidden, true);
  assert.equal(data.instances[0].health.downSince, "2026-10-11T00:00:00.000Z");
});

test("optional fields get stable placeholders", () => {
  const data = buildHubData({ instances: [{ id: "x", url: "https://x.test" }] }, {});
  const [item] = data.instances;
  assert.deepEqual(item.languages, []);
  assert.deepEqual(item.regions, []);
  assert.deepEqual(item.social, []);
  assert.equal(item.timezone, "UTC");
  assert.equal(item.health, null);
});

test("an empty or missing manifest yields an empty snapshot", () => {
  assert.deepEqual(buildHubData({}, {}).instances, []);
  assert.deepEqual(buildHubData(null, null).instances, []);
});

test("cards come from var/cards by instance id", () => {
  const data = buildHubData(
    { instances: [{ id: "a", url: "https://a.test" }, { id: "b", url: "https://b.test" }] },
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
    { instances: [{ id: "a", url: "https://a.test" }, { id: "b", url: "https://b.test" }] },
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

test("logo is an absolute https url or nothing", () => {
  const data = buildHubData(
    { instances: [{ id: "a", url: "https://a.test" }, { id: "b", url: "https://b.test" }] },
    {},
    undefined,
    {},
    {},
    {
      a: { profile: { name: { en: "A" }, logo: "https://cdn.test/a.png" } },
      // 相对路径不再是合法值：门户不猜站点根目录长什么样。
      b: { profile: { name: { en: "B" }, logo: "/logos/b.svg" } },
    }
  );
  assert.deepEqual(
    data.instances.map((item) => item.logo),
    ["https://cdn.test/a.png", null]
  );
});
