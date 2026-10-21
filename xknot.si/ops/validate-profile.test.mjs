import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { cleanSite, LIMITS } from "./profile-schema.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

function base(overrides = {}) {
  return {
    name: "Knot Travel SG",
    tagline: "Slow travel around Southeast Asia.",
    intro: "A small Knot for slow travel.",
    owner: "Mei",
    contact: "ops@example.test",
    region: "SG",
    timezone: "Asia/Singapore",
    tags: ["旅行", "东南亚"],
    ...overrides,
  };
}

test("a well-formed site passes", () => {
  const checked = cleanSite(base());
  assert.deepEqual(checked.problems, []);
  assert.equal(checked.ok, true);
  assert.equal(checked.site.name, "Knot Travel SG");
  assert.deepEqual(checked.site.tags, ["旅行", "东南亚"]);
});

test("the shipped preview profiles are valid", async () => {
  const payload = JSON.parse(await readFile(path.join(here, "..", "fixtures", "preview-profiles.json"), "utf8"));
  for (const [id, cached] of Object.entries(payload)) {
    const checked = cleanSite(cached.site);
    assert.deepEqual(checked.problems, [], `${id}: ${checked.problems.join("; ")}`);
  }
});

test("name is required, everything else is optional", () => {
  const checked = cleanSite({});
  assert.ok(checked.problems.includes("name: required"));
  assert.equal(checked.site, null);

  const minimal = cleanSite({ name: "Knot" });
  assert.deepEqual(minimal.problems, []);
  assert.equal(minimal.site.contact, undefined);
  assert.equal(minimal.site.tags, undefined);
});

test("a locale map is no longer accepted where a string belongs", () => {
  // v1 的写法必须整份被拒，否则会静默显示成 "[object Object]"。
  const checked = cleanSite(base({ name: { en: "Knot Travel" } }));
  assert.ok(checked.problems.includes("name: required"));
});

test("unknown fields are rejected so the contract stays tight", () => {
  const checked = cleanSite(base({ slogan: "hi" }));
  assert.ok(checked.problems.includes("slogan: unknown field, remove it"));
  for (const retired of ["languages", "regions", "themeColor", "social", "shortName", "operator", "vertical"]) {
    assert.ok(
      cleanSite(base({ [retired]: "x" })).problems.includes(`${retired}: unknown field, remove it`),
      retired
    );
  }
});

test("region is one country code or GLOBAL, upper-cased", () => {
  assert.equal(cleanSite(base({ region: "sg" })).site.region, "SG");
  assert.equal(cleanSite(base({ region: "GLOBAL" })).site.region, "GLOBAL");
  assert.ok(cleanSite(base({ region: "中国" })).problems.includes("region: must be a two-letter country code, or GLOBAL"));
});

test("timezone must be a real IANA name", () => {
  assert.ok(cleanSite(base({ timezone: "GMT+8" })).problems.includes('timezone: unknown "GMT+8"'));
  assert.deepEqual(cleanSite(base({ timezone: "UTC" })).problems, []);
});

test("logo must be https or omitted", () => {
  assert.ok(cleanSite(base({ logo: "/logos/site.svg" })).problems.includes("logo: must be https, or omit it"));
  assert.deepEqual(cleanSite(base({ logo: null })).problems, []);
  assert.deepEqual(cleanSite(base({ logo: "https://cdn.test/a.png" })).problems, []);
});

test("tags are free text: capped at nine, clipped at sixteen, deduplicated", () => {
  const many = Array.from({ length: LIMITS.tags + 1 }, (_, index) => `t${index}`);
  assert.ok(cleanSite(base({ tags: many })).problems.includes(`tags: more than ${LIMITS.tags}`));
  assert.deepEqual(cleanSite(base({ tags: ["Travel", "travel", "旅行"] })).site.tags, ["Travel", "旅行"]);
  assert.deepEqual(cleanSite(base({ tags: ["x".repeat(LIMITS.tag + 4)] })).site.tags, ["x".repeat(LIMITS.tag)]);
  assert.ok(cleanSite(base({ tags: "travel" })).problems.includes("tags: must be an array of strings"));
});

test("long text is clipped rather than rejected", () => {
  const long = "字".repeat(LIMITS.intro + 5);
  const checked = cleanSite(base({ intro: long }));
  assert.deepEqual(checked.problems, []);
  assert.equal([...checked.site.intro].length, LIMITS.intro);
});

test("an empty site document is allowed: the node has not written one yet", () => {
  assert.deepEqual(cleanSite(null), { ok: true, problems: [], site: null });
});
