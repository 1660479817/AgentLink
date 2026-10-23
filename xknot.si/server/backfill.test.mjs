import assert from "node:assert/strict";
import test from "node:test";

import { labelFromUrl } from "../ops/subdomain.mjs";
import { backfillApplication } from "./backfill.mjs";
import { openMemoryStore } from "./store.mjs";

const manifest = {
  version: 5,
  instances: [
    { id: "wang", url: "https://wang.xknot.si", since: "2026-10-19", tier: "paid", status: "active" },
    { id: "own", url: "https://knot.example.com", since: "2026-10-01", tier: "free", status: "active" },
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

test("only a hub-issued subdomain has a label to backfill", () => {
  assert.equal(labelFromUrl("https://wang.xknot.si"), "wang");
  // 多级子域不是中枢签发的形态，不能当成标签。
  assert.equal(labelFromUrl("https://a.b.xknot.si"), "");
  assert.equal(labelFromUrl("https://knot.example.com"), "");
  assert.equal(labelFromUrl("not a url"), "");
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
  assert.equal(app.subdomain, "wang");
  assert.equal(app.name, "王家小站");
  assert.equal(app.operator, "PaulWang");
  assert.equal(app.intro, "只收值得换的信息。");
  assert.equal(app.region, "CN");
  assert.equal(app.timezone, "Asia/Shanghai");
  assert.deepEqual(app.tags, ["exchange"]);
  // 签发日取自清单，不是补记这天。
  assert.equal(app.reviewedAt, "2026-10-19T00:00:00.000Z");
  assert.equal(app.reviewedBy, "paul");
  store.close();
});

test("running it twice does not add a second application", () => {
  const store = seed();
  const first = backfillApplication({
    store,
    manifest,
    instanceId: "wang",
    email: "owner@example.test",
    region: "CN",
  });
  const second = backfillApplication({
    store,
    manifest,
    instanceId: "wang",
    email: "owner@example.test",
    region: "CN",
  });
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

test("an instance outside the hub domain cannot be backfilled", () => {
  const store = seed();
  const result = backfillApplication({ store, manifest, instanceId: "own", email: "owner@example.test" });
  assert.equal(result.error, "not_hub_subdomain");
  assert.equal(store.listApplications().length, 0);
  store.close();
});

test("an unknown id and a missing or malformed email are refused, not invented", () => {
  const store = seed();
  assert.equal(backfillApplication({ store, manifest, instanceId: "nope", email: "a@b.test" }).error, "no_instance");
  assert.equal(backfillApplication({ store, manifest, instanceId: "wang", email: "" }).error, "bad_email");
  assert.equal(
    backfillApplication({ store, manifest, instanceId: "wang", email: "not-an-address", region: "CN" }).error,
    "bad_email"
  );
  assert.equal(store.listApplications().length, 0);
  store.close();
});

test("without a profile the name falls back to the instance id", () => {
  const store = seed();
  const result = backfillApplication({
    store,
    manifest,
    instanceId: "wang",
    email: "owner@example.test",
    region: "CN",
  });
  assert.equal(result.application.name, "wang");
  assert.equal(result.application.timezone, "UTC");
  store.close();
});

test("a profile without a usable region is refused instead of filling one in", () => {
  const store = seed();
  const result = backfillApplication({
    store,
    manifest,
    instanceId: "wang",
    email: "owner@example.test",
    profile: { site: { name: "王家小站", region: "" } },
  });
  assert.equal(result.error, "no_region");
  assert.equal(store.listApplications().length, 0);
  // 自述区真的写了 GLOBAL 就照写：那是「覆盖全球」，不是「不知道在哪」。
  const explicit = backfillApplication({
    store,
    manifest,
    instanceId: "wang",
    email: "owner@example.test",
    profile: { site: { name: "王家小站", region: "GLOBAL" } },
  });
  assert.equal(explicit.application.region, "GLOBAL");
  store.close();
});

test("profile text goes through the same cleaning and limits as an application", () => {
  const store = seed();
  const result = backfillApplication({
    store,
    manifest,
    instanceId: "wang",
    email: "Owner@Example.Test",
    profile: {
      site: {
        name: "王家\n小站",
        owner: "Paul",
        tagline: "x".repeat(200),
        region: "cn",
        tags: ["a".repeat(20), "exchange"],
      },
    },
  });
  assert.ok(result.created, JSON.stringify(result));
  const app = result.application;
  // 换行被折成空格：这个值会原样进内部信正文。
  assert.equal(app.name, "王家 小站");
  assert.equal(app.email, "owner@example.test");
  assert.equal(app.region, "CN");
  assert.equal([...app.intro].length, 60);
  // 超长标签不进库，合规的保留。
  assert.deepEqual(app.tags, ["exchange"]);
  store.close();
});
