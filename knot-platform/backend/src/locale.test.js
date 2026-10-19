import assert from "node:assert/strict";
import { test } from "node:test";
import { countryFromRequest, localeFromCountry, parseLocale, regionForRequest } from "./locale.js";

function request(headers) {
  return {
    get(name) {
      return headers[String(name).toLowerCase()];
    },
  };
}

test("mainland China stays simplified", () => {
  assert.equal(localeFromCountry("CN"), "zh-CN");
  assert.equal(localeFromCountry("cn"), "zh-CN");
});

test("an unknown country uses English", () => {
  assert.equal(localeFromCountry(""), "en");
  assert.equal(localeFromCountry("XX"), "en");
  assert.equal(localeFromCountry("T1"), "en");
});

test("Taiwan, Hong Kong, and Macau use traditional Chinese", () => {
  assert.equal(localeFromCountry("TW"), "zh-TW");
  assert.equal(localeFromCountry("hk"), "zh-TW");
  assert.equal(localeFromCountry("MO"), "zh-TW");
});

test("other known countries use English", () => {
  assert.equal(localeFromCountry("US"), "en");
  assert.equal(localeFromCountry("JP"), "en");
  assert.equal(localeFromCountry("SG"), "en");
});

test("the country comes from CF-IPCountry", () => {
  assert.equal(countryFromRequest(request({ "cf-ipcountry": "us" })), "US");
  assert.equal(regionForRequest(request({})), "en");
  assert.equal(regionForRequest(request({ "cf-ipcountry": "TW" })), "zh-TW");
});

test("only the three language regions can be saved", () => {
  assert.equal(parseLocale("en"), "en");
  assert.equal(parseLocale(" zh-TW "), "zh-TW");
  assert.equal(parseLocale("ja"), null);
  assert.equal(parseLocale(""), null);
  assert.equal(parseLocale(null), null);
});
