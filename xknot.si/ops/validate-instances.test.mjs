import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateInstance, validateInstances } from "./validate-instances.mjs";
import { LOCALES } from "../web/src/lib/i18n.js";

const here = path.dirname(fileURLToPath(import.meta.url));

function base(overrides = {}) {
  return {
    id: "travel-sg",
    name: { en: "Knot Travel SG", "zh-CN": "Knot 旅行 新加坡" },
    operator: { en: "Example OPC" },
    intro: { oneLine: { en: "Slow travel around Southeast Asia." } },
    languages: ["en", "zh-CN"],
    regions: ["SG", "MY"],
    timezone: "Asia/Singapore",
    contact: "ops@example.test",
    since: "2026-10-19",
    tier: "partner",
    status: "active",
    url: "https://travel.xknot.si",
    ...overrides,
  };
}

test("a well-formed instance has no problems", () => {
  assert.deepEqual(validateInstance(base()), []);
});

test("the shipped instances.json is valid", async () => {
  const manifest = JSON.parse(await readFile(path.join(here, "..", "instances.json"), "utf8"));
  assert.deepEqual(validateInstances(manifest), []);
});

test("name.en is required", () => {
  const errors = validateInstance(base({ name: { "zh-CN": "旅行" } }));
  assert.ok(errors.includes("name.en: required"));
});

test("intro.oneLine.en is required", () => {
  const errors = validateInstance(base({ intro: { oneLine: { "zh-CN": "慢旅行" } } }));
  assert.ok(errors.includes("intro.oneLine.en: required"));
});

test("a plain string where a locale map belongs is rejected", () => {
  const errors = validateInstance(base({ name: "Knot Travel" }));
  assert.ok(errors.some((error) => error.startsWith("name: must be a locale map")));
});

test("an empty string is rejected and the fix is to omit the key", () => {
  const errors = validateInstance(base({ name: { en: "Knot Travel SG", "zh-TW": "" } }));
  assert.ok(errors.includes("name.zh-TW: empty string, omit the key instead"));
});

test("unknown locales are rejected", () => {
  const errors = validateInstance(base({ name: { en: "Knot", fr: "Knot" } }));
  assert.ok(errors.includes("name.fr: unknown locale"));
});

test("languages must include en and stay in the whitelist", () => {
  assert.ok(validateInstance(base({ languages: ["zh-CN"] })).includes("languages: must include en"));
  assert.ok(validateInstance(base({ languages: ["en", "ja"] })).includes('languages: unknown locale "ja"'));
});

test("regions must be known country codes", () => {
  assert.ok(validateInstance(base({ regions: ["XX"] })).includes('regions: unknown code "XX"'));
  assert.deepEqual(validateInstance(base({ regions: ["GLOBAL"] })), []);
  assert.ok(validateInstance(base({ regions: ["GLOBAL", "SG"] })).includes("regions: GLOBAL must be used alone"));
});

test("timezone must be a real IANA name", () => {
  assert.ok(validateInstance(base({ timezone: "GMT+8" })).includes('timezone: unknown "GMT+8"'));
  assert.deepEqual(validateInstance(base({ timezone: "UTC" })), []);
});

test("urls must be https", () => {
  assert.ok(validateInstance(base({ url: "http://x.test" })).includes("url: must be https"));
  assert.ok(validateInstance(base({ cardsUrl: "http://x.test/cards.json" })).includes("cardsUrl: must be https"));
});

test("tier and status are enumerations", () => {
  assert.ok(validateInstance(base({ tier: "flagship" })).some((error) => error.startsWith("tier:")));
  assert.ok(validateInstance(base({ status: "gone" })).some((error) => error.startsWith("status:")));
});

test("ids allow two-character names such as ai", () => {
  assert.deepEqual(validateInstance(base({ id: "ai" })), []);
  assert.ok(validateInstance(base({ id: "a" })).some((error) => error.startsWith("id:")));
  assert.ok(validateInstance(base({ id: "Travel_SG" })).some((error) => error.startsWith("id:")));
});

test("since is an ISO date", () => {
  assert.ok(validateInstance(base({ since: "2026/10/19" })).includes("since: must be YYYY-MM-DD"));
  assert.deepEqual(validateInstance(base({ since: "2026-10-19" })), []);
});

test("ids are unique across the manifest", () => {
  const problems = validateInstances({ instances: [base(), base()] });
  const first = problems.find(([id]) => id === "travel-sg");
  assert.ok(first[1].some((error) => error.startsWith("id: duplicate")));
});

test("every locale catalog defines the same keys", async () => {
  const catalogs = {};
  for (const locale of LOCALES) {
    catalogs[locale] = JSON.parse(
      await readFile(path.join(here, "..", "web", "src", "locales", `${locale}.json`), "utf8")
    );
  }
  const shape = (node, prefix = "") =>
    Object.entries(node).flatMap(([key, value]) =>
      value && typeof value === "object" ? shape(value, `${prefix}${key}.`) : [`${prefix}${key}`]
    );

  const reference = shape(catalogs.en).sort();
  for (const locale of LOCALES) {
    assert.deepEqual(shape(catalogs[locale]).sort(), reference, `${locale} keys differ from en`);
  }
});

test("every catalog leaves no empty string", async () => {
  for (const locale of LOCALES) {
    const catalog = JSON.parse(
      await readFile(path.join(here, "..", "web", "src", "locales", `${locale}.json`), "utf8")
    );
    const walk = (node, prefix = "") => {
      for (const [key, value] of Object.entries(node)) {
        const full = `${prefix}${key}`;
        if (typeof value === "string") assert.notEqual(value.trim(), "", `${locale}: ${full} is empty`);
        else if (value && typeof value === "object") walk(value, `${full}.`);
      }
    };
    walk(catalog);
  }
});
