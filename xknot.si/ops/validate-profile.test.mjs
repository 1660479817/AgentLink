import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { cleanProfile, LIMITS } from "./profile-schema.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

function base(overrides = {}) {
  return {
    name: { en: "Knot Travel SG", "zh-CN": "Knot 旅行 新加坡" },
    intro: { oneLine: { en: "Slow travel around Southeast Asia." } },
    languages: ["en", "zh-CN"],
    regions: ["SG", "MY"],
    timezone: "Asia/Singapore",
    contact: "ops@example.test",
    ...overrides,
  };
}

test("a well-formed profile passes", () => {
  const checked = cleanProfile(base());
  assert.deepEqual(checked.problems, []);
  assert.equal(checked.ok, true);
  assert.equal(checked.profile.name.en, "Knot Travel SG");
});

test("the shipped preview profiles are valid", async () => {
  const payload = JSON.parse(await readFile(path.join(here, "..", "fixtures", "preview-profiles.json"), "utf8"));
  for (const [id, cached] of Object.entries(payload)) {
    const checked = cleanProfile(cached.profile);
    assert.deepEqual(checked.problems, [], `${id}: ${checked.problems.join("; ")}`);
  }
});

test("name and intro.oneLine are required, contact is optional", () => {
  const checked = cleanProfile({});
  assert.ok(checked.problems.includes("name: required"));
  assert.ok(checked.problems.includes("intro.oneLine: required"));
  assert.equal(checked.profile, null);

  const minimal = cleanProfile({ name: { en: "Knot" }, intro: { oneLine: { en: "Exchange" } } });
  assert.deepEqual(minimal.problems, []);
  assert.equal(minimal.profile.contact, undefined);
});

test("a plain string where a locale map belongs is rejected", () => {
  const checked = cleanProfile(base({ name: "Knot Travel" }));
  assert.ok(checked.problems.some((problem) => problem.startsWith("name: must be a locale map")));
});

test("an empty string is rejected and the fix is to omit the key", () => {
  const checked = cleanProfile(base({ name: { en: "Knot Travel SG", "zh-TW": "" } }));
  assert.ok(checked.problems.includes("name.zh-TW: empty string, omit the key instead"));
});

test("unknown locales are rejected", () => {
  const checked = cleanProfile(base({ name: { en: "Knot", fr: "Knot" } }));
  assert.ok(checked.problems.includes("name.fr: unknown locale"));
});

test("en is recommended but not required: any locale is enough", () => {
  const checked = cleanProfile(base({ name: { "zh-TW": "旅行" }, intro: { oneLine: { "zh-TW": "慢旅行" } } }));
  assert.deepEqual(checked.problems, []);
  assert.deepEqual(checked.profile.name, { "zh-TW": "旅行" });
});

test("unknown fields are rejected so the contract stays tight", () => {
  const checked = cleanProfile(base({ slogan: "hi" }));
  assert.ok(checked.problems.includes("slogan: unknown field, remove it"));
});

test("languages must stay in the whitelist", () => {
  assert.ok(cleanProfile(base({ languages: ["en", "ja"] })).problems.includes('languages: unknown locale "ja"'));
  assert.ok(cleanProfile(base({ languages: [] })).problems.includes("languages: must be a non-empty array"));
});

test("regions must be known country codes or GLOBAL alone", () => {
  assert.ok(cleanProfile(base({ regions: ["XX"] })).problems.includes('regions: unknown code "XX"'));
  assert.deepEqual(cleanProfile(base({ regions: ["GLOBAL"] })).problems, []);
  assert.ok(cleanProfile(base({ regions: ["GLOBAL", "SG"] })).problems.includes("regions: GLOBAL must be used alone"));
});

test("timezone must be a real IANA name", () => {
  assert.ok(cleanProfile(base({ timezone: "GMT+8" })).problems.includes('timezone: unknown "GMT+8"'));
  assert.deepEqual(cleanProfile(base({ timezone: "UTC" })).problems, []);
});

test("logo and policy urls must be https or null", () => {
  assert.ok(cleanProfile(base({ logo: "/logos/site.svg" })).problems.includes("logo: must be https, or null"));
  assert.ok(cleanProfile(base({ termsUrl: "http://x.test/terms" })).problems.includes("termsUrl: must be https, or null"));
  assert.deepEqual(cleanProfile(base({ logo: null, termsUrl: null })).problems, []);
});

test("themeColor is #RRGGBB", () => {
  assert.ok(cleanProfile(base({ themeColor: "blue" })).problems.includes("themeColor: must be #RRGGBB"));
  assert.deepEqual(cleanProfile(base({ themeColor: "#0866FF" })).problems, []);
});

test("tags are localized arrays with a cap", () => {
  const many = ["a", "b", "c", "d", "e", "f"];
  assert.ok(cleanProfile(base({ tags: { en: many } })).problems.includes(`tags.en: more than ${LIMITS.tags}`));
  assert.deepEqual(cleanProfile(base({ tags: { en: ["travel"] } })).profile.tags, { en: ["travel"] });
});

test("social entries need a label and an https url", () => {
  const checked = cleanProfile(base({ social: [{ label: "", url: "http://x.test" }] }));
  assert.ok(checked.problems.includes("social[0].label: required"));
  assert.ok(checked.problems.includes("social[0].url: must be https"));
});

test("long text is clipped rather than rejected", () => {
  const long = "字".repeat(LIMITS.oneLine + 5);
  const checked = cleanProfile(base({ intro: { oneLine: { en: long } } }));
  assert.deepEqual(checked.problems, []);
  assert.equal([...checked.profile.intro.oneLine.en].length, LIMITS.oneLine);
});

test("an empty profile document is allowed", () => {
  assert.deepEqual(cleanProfile(null), { ok: true, problems: [], profile: null });
});
