import assert from "node:assert/strict";
import test from "node:test";

import { COUNTRY_CODES } from "./regions.js";
import { COUNTRY_TIMEZONE, timezoneOf } from "./timezones.js";

// 190 个代码一个都不能漏：漏了的那个国家在页面上的钟会静默退回 UTC。
test("every country the hub groups has a timezone", () => {
  const missing = [...COUNTRY_CODES].filter((code) => code !== "GLOBAL" && !COUNTRY_TIMEZONE[code]);
  assert.deepEqual(missing, []);
});

test("every timezone is a name Intl actually knows", () => {
  const bad = Object.entries(COUNTRY_TIMEZONE)
    .filter(([, zone]) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: zone });
        return false;
      } catch {
        return true;
      }
    })
    .map(([code, zone]) => `${code}=${zone}`);
  assert.deepEqual(bad, []);
});

test("the table has no entries outside the country list", () => {
  const extra = Object.keys(COUNTRY_TIMEZONE).filter((code) => !COUNTRY_CODES.has(code));
  assert.deepEqual(extra, []);
});

test("lookup is case-insensitive and rejects what it cannot know", () => {
  assert.equal(timezoneOf("cn"), "Asia/Shanghai");
  assert.equal(timezoneOf(" SG "), "Asia/Singapore");
  assert.equal(timezoneOf("US"), "America/New_York");
  assert.equal(timezoneOf("GLOBAL"), null);
  assert.equal(timezoneOf("ZZ"), null);
  assert.equal(timezoneOf(""), null);
  assert.equal(timezoneOf(null), null);
  assert.equal(timezoneOf(42), null);
});

test("multi-zone countries get their capital's or largest city's clock", () => {
  // 只钉几个容易改错方向的，改表时先想清楚是不是有意的。
  assert.equal(timezoneOf("CN"), "Asia/Shanghai");
  assert.equal(timezoneOf("JP"), "Asia/Tokyo");
  assert.equal(timezoneOf("IN"), "Asia/Kolkata");
  assert.equal(timezoneOf("BR"), "America/Sao_Paulo");
  assert.equal(timezoneOf("AU"), "Australia/Sydney");
  assert.equal(timezoneOf("RU"), null); // 俄罗斯不在分组表里，不猜
});
