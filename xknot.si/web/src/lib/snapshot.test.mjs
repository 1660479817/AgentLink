import assert from "node:assert/strict";
import test from "node:test";

import { buildHubData } from "./snapshot.js";

const MANIFEST = {
  instances: [
    {
      id: "root",
      name: { en: "Knot" },
      url: "https://root.xknot.si",
      redirect: "https://knot.zenheart.net",
      languages: ["en", "zh-CN"],
      regions: ["GLOBAL"],
      timezone: "Asia/Shanghai",
      intro: { oneLine: { en: "An information exchange network." } },
      tier: "demo",
      status: "active",
      since: "2026-10-19",
      healthUrl: "https://knot.zenheart.net/api/health",
    },
  ],
};

const HEALTH = {
  checkedAt: "2026-10-19T02:30:00.000Z",
  instances: {
    root: { status: "up", lastOkAt: "2026-10-19T02:30:00.000Z", latencyMs: 137, version: "0.2.0" },
  },
};

test("the snapshot carries manifest fields plus the probe result", () => {
  const data = buildHubData(MANIFEST, HEALTH, new Date("2026-10-19T03:00:00Z"));
  assert.equal(data.generatedAt, "2026-10-19T03:00:00.000Z");
  assert.equal(data.checkedAt, "2026-10-19T02:30:00.000Z");

  const [root] = data.instances;
  assert.equal(root.id, "root");
  assert.equal(root.name.en, "Knot");
  assert.equal(root.redirect, "https://knot.zenheart.net");
  assert.deepEqual(root.regions, ["GLOBAL"]);
  assert.deepEqual(root.health, {
    status: "up",
    lastOkAt: "2026-10-19T02:30:00.000Z",
    latencyMs: 137,
    version: "0.2.0",
    checkedAt: "2026-10-19T02:30:00.000Z",
  });
});

test("an instance without a probe result keeps health null", () => {
  const data = buildHubData(MANIFEST, { instances: {} });
  assert.equal(data.instances[0].health, null);
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
