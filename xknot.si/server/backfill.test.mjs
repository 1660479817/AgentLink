import assert from "node:assert/strict";
import test from "node:test";

import { backfillApplication, modeOf } from "./backfill.mjs";
import { openMemoryStore } from "./store.mjs";

const manifest = {
  version: 5,
  instances: [
    { id: "wang", url: "https://wang.xknot.si", since: "2026-10-19", tier: "partner", status: "active" },
    { id: "own", url: "https://knot.example.com", since: "2026-10-01", tier: "community", status: "active" },
  ],
};

const profile = {
  site: {
    name: "王家小站",
    owner: "PaulWang",
    tagline: "只收值得换的信息。",
    region: "CN",
    timezone: "Asia/Shanghai",
    tags: ["exchange"],
  },
};

function seed() {
  return openMemoryStore();
}

test("a hub-issued subdomain is a subdomain application", () => {
  assert.deepEqual(modeOf({ url: "https://wang.xknot.si" }), { mode: "subdomain", subdomain: "wang" });
});

test("any other address is an own-domain application", () => {
  assert.deepEqual(modeOf({ url: "https://knot.example.com" }), { mode: "own-domain", subdomain: null });
  // 多级子域不是中枢签发的形态，不能当成标签。
  assert.deepEqual(modeOf({ url: "https://a.b.xknot.si" }), { mode: "own-domain", subdomain: null });
  assert.deepEqual(modeOf({ url: "not a url" }), { mode: "own-domain", subdomain: null });
});

test("the backfilled application carries the signer's facts and says where it came from", () => {
  const store = seed();
  const result = backfillApplication({
    store,
    manifest,
    instanceId: "wang",
    profile,
    email: "owner@example.test",
    admin: "paul",
    now: new Date("2026-10-21T00:00:00Z"),
  });

  assert.ok(result.created, JSON.stringify(result));
  const app = result.application;
  assert.equal(app.status, "approved");
  assert.equal(app.url, "https://wang.xknot.si");
  assert.equal(app.mode, "subdomain");
  assert.equal(app.subdomain, "wang");
  assert.equal(app.name, "王家小站");
  assert.equal(app.operator, "PaulWang");
  assert.equal(app.intro, "只收值得换的信息。");
  assert.equal(app.region, "CN");
  assert.equal(app.timezone, "Asia/Shanghai");
  assert.deepEqual(app.tags, ["exchange"]);
  // 签发日取自清单，不是补记这天。
  assert.equal(app.verifiedAt, "2026-10-19T00:00:00.000Z");
  assert.equal(app.reviewedBy, "paul");
  assert.match(app.reviewNote, /补记/);
  assert.match(app.reviewNote, /instances\.json/);
  store.close();
});

test("running it twice does not add a second application", () => {
  const store = seed();
  const first = backfillApplication({ store, manifest, instanceId: "wang", email: "owner@example.test" });
  const second = backfillApplication({ store, manifest, instanceId: "wang", email: "owner@example.test" });
  assert.equal(second.skipped, "exists");
  assert.equal(second.application.id, first.application.id);
  assert.equal(store.listApplications().length, 1);
  store.close();
});

test("an open application counts as present, so no duplicate is added", () => {
  const store = seed();
  // 有单在审核中就不该补：否则同一站点会有两张单。
  const open = store.createApplication({
    name: "王家小站",
    mode: "subdomain",
    subdomain: "wang",
    operator: "PaulWang",
    email: "owner@example.test",
    region: "CN",
    timezone: "Asia/Shanghai",
    intro: "",
  });
  const result = backfillApplication({ store, manifest, instanceId: "wang", email: "owner@example.test" });
  assert.equal(result.skipped, "exists");
  assert.equal(result.application.id, open.id);
  store.close();
});

test("an own-domain instance keeps its own address", () => {
  const store = seed();
  const result = backfillApplication({ store, manifest, instanceId: "own", email: "owner@example.test" });
  assert.equal(result.application.url, "https://knot.example.com");
  assert.equal(result.application.mode, "own-domain");
  assert.equal(result.application.subdomain, null);
  store.close();
});

test("an unknown id and a missing email are refused, not invented", () => {
  const store = seed();
  assert.equal(backfillApplication({ store, manifest, instanceId: "nope", email: "a@b.test" }).error, "no_instance");
  assert.equal(backfillApplication({ store, manifest, instanceId: "wang", email: "" }).error, "no_email");
  assert.equal(store.listApplications().length, 0);
  store.close();
});

test("without a profile the name falls back to the instance id", () => {
  const store = seed();
  const result = backfillApplication({ store, manifest, instanceId: "wang", email: "owner@example.test" });
  assert.equal(result.application.name, "wang");
  assert.equal(result.application.timezone, "UTC");
  store.close();
});
