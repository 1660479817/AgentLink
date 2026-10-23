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
    url: "https://travel-sg.xknot.si",
    since: "2026-10-19",
    tier: "paid",
    status: "active",
    ...overrides,
  };
}

test("a well-formed entry has no problems", () => {
  assert.deepEqual(validateInstance(base()), []);
});

test("the shipped instances.json is valid", async () => {
  const manifest = JSON.parse(await readFile(path.join(here, "..", "instances.json"), "utf8"));
  assert.deepEqual(validateInstances(manifest), []);
});

test("the preview fixtures are valid too", async () => {
  const manifest = JSON.parse(await readFile(path.join(here, "..", "fixtures", "preview-instances.json"), "utf8"));
  assert.deepEqual(validateInstances(manifest), []);
});

test("self-described fields are rejected: they belong in profile.json", () => {
  for (const field of ["name", "intro", "operator", "owner", "tags", "contact", "timezone"]) {
    const errors = validateInstance(base({ [field]: "x" }));
    assert.ok(
      errors.some((error) => error.startsWith(`${field}: unknown field`)),
      `${field} must be reported as unknown`
    );
  }
});

test("healthUrl is rejected: the probe url is derived from url", () => {
  const errors = validateInstance(base({ healthUrl: "https://travel.xknot.si/api/health" }));
  assert.ok(errors.some((error) => error.startsWith("healthUrl:")));
});

test("urls must be https", () => {
  assert.ok(validateInstance(base({ url: "http://x.test" })).includes("url: must be https"));
  assert.ok(validateInstance(base({ cardsUrl: "http://x.test/cards.json" })).includes("cardsUrl: must be https or omitted"));
});

test("the listed url must be a hub-issued subdomain", () => {
  assert.ok(validateInstance(base({ url: "https://knot.example.com" })).includes("url: must be https://<label>.xknot.si"));
  assert.ok(validateInstance(base({ url: "https://a.b.xknot.si" })).includes("url: must be https://<label>.xknot.si"));
  // 早期签发的短号照样通过；长度与保留名只在签发时判。
  assert.deepEqual(validateInstance(base({ id: "wang", url: "https://wang.xknot.si" })), []);
});

test("the url label must equal the id", () => {
  // 指向别人的子域时，门户会把这个条目显示成对方的站点、流量也记到对方名下。
  assert.ok(
    validateInstance(base({ id: "cpswang", url: "https://wang.xknot.si" })).includes(
      'url: label "wang" must equal id "cpswang"'
    )
  );
});

test("tier and status are enumerations", () => {
  assert.ok(validateInstance(base({ tier: "flagship" })).some((error) => error.startsWith("tier:")));
  assert.ok(validateInstance(base({ status: "gone" })).some((error) => error.startsWith("status:")));
});

test("ids allow two-character names such as ai", () => {
  assert.deepEqual(validateInstance(base({ id: "ai", url: "https://ai.xknot.si" })), []);
  assert.ok(validateInstance(base({ id: "a" })).some((error) => error.startsWith("id:")));
  assert.ok(validateInstance(base({ id: "Travel_SG" })).some((error) => error.startsWith("id:")));
});

test("since is an ISO date", () => {
  assert.ok(validateInstance(base({ since: "2026/10/19" })).includes("since: must be YYYY-MM-DD"));
  assert.deepEqual(validateInstance(base({ since: "2026-10-19" })), []);
});

test("ids are unique across the manifest", () => {
  const problems = validateInstances({ version: 1, updatedAt: "2026-01-01", instances: [base(), base()] });
  assert.equal(problems.length, 1);
  assert.ok(problems[0][1].some((error) => error.startsWith("id: duplicate")));
});

test("the manifest header is checked, not just carried along", () => {
  // 两个字段以前从不读：写成字符串、删掉、格式错了都照样通过校验（S24-16）。
  const instances = [base()];
  const badVersion = validateInstances({ version: "6", updatedAt: "2026-01-01", instances });
  assert.ok(badVersion.some(([, errors]) => errors.some((error) => error.startsWith("version:"))));
  const noVersion = validateInstances({ updatedAt: "2026-01-01", instances });
  assert.ok(noVersion.some(([, errors]) => errors.some((error) => error.startsWith("version:"))));
  const badDate = validateInstances({ version: 6, updatedAt: "2026/01/01", instances });
  assert.ok(badDate.some(([, errors]) => errors.some((error) => error.startsWith("updatedAt:"))));
  assert.deepEqual(validateInstances({ version: 6, updatedAt: "2026-01-01", instances }), []);
});

test("every locale catalog defines the same keys", async () => {
  const catalogs = await Promise.all(
    LOCALES.map(async (locale) => {
      const file = path.join(here, "..", "web", "src", "locales", `${locale}.json`);
      return [locale, JSON.parse(await readFile(file, "utf8"))];
    })
  );
  const flat = (value, prefix = "") =>
    Object.entries(value).flatMap(([key, entry]) =>
      entry && typeof entry === "object" ? flat(entry, `${prefix}${key}.`) : [`${prefix}${key}`]
    );
  const sets = catalogs.map(([locale, catalog]) => [locale, new Set(flat(catalog))]);
  const [, reference] = sets[0];
  for (const [locale, keys] of sets) {
    const missing = [...reference].filter((key) => !keys.has(key));
    const extra = [...keys].filter((key) => !reference.has(key));
    assert.deepEqual(missing, [], `${locale} is missing keys`);
    assert.deepEqual(extra, [], `${locale} has keys the others do not`);
  }
});

test("every catalog leaves no empty string", async () => {
  for (const locale of LOCALES) {
    const file = path.join(here, "..", "web", "src", "locales", `${locale}.json`);
    const text = await readFile(file, "utf8");
    const catalog = JSON.parse(text);
    const walk = (value, trail) => {
      for (const [key, entry] of Object.entries(value)) {
        const where = trail ? `${trail}.${key}` : key;
        if (typeof entry === "string") assert.ok(entry.trim(), `${locale}:${where} is empty`);
        else walk(entry, where);
      }
    };
    walk(catalog, "");
  }
});
