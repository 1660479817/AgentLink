import assert from "node:assert/strict";
import { test } from "node:test";
import { countryFromRequest, localeFromAcceptLanguage, localeFromCountry, parseLocale, regionForRequest } from "./locale.js";

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

test("no country header falls back to Accept-Language", () => {
  // 入口是直连 nginx，没有 Cloudflare 头：这时只看浏览器偏好。
  assert.equal(regionForRequest(request({ "accept-language": "zh-CN,zh;q=0.9,en;q=0.8" })), "zh-CN");
  assert.equal(regionForRequest(request({ "accept-language": "zh-TW,zh;q=0.9" })), "zh-TW");
  assert.equal(regionForRequest(request({ "accept-language": "en-US,en;q=0.9" })), "en");
  // 不认识的语种不猜。
  assert.equal(regionForRequest(request({ "accept-language": "ja-JP,ja;q=0.9" })), "en");
});

test("country wins over Accept-Language", () => {
  assert.equal(
    regionForRequest(request({ "cf-ipcountry": "US", "accept-language": "zh-CN,zh;q=0.9" })),
    "en",
  );
});

test("XX and T1 are not real regions", () => {
  assert.equal(regionForRequest(request({ "cf-ipcountry": "XX", "accept-language": "zh-CN" })), "zh-CN");
  assert.equal(regionForRequest(request({ "cf-ipcountry": "T1" })), "en");
});

test("Accept-Language honours q values and region subtags", () => {
  assert.equal(localeFromAcceptLanguage("en;q=0.4, zh-Hans-CN;q=0.9"), "zh-CN");
  assert.equal(localeFromAcceptLanguage("zh-Hant"), "zh-TW");
  assert.equal(localeFromAcceptLanguage("zh-HK"), "zh-TW");
  assert.equal(localeFromAcceptLanguage(""), "");
  assert.equal(localeFromAcceptLanguage("zh;q=0"), "");
});

test("only the three language regions can be saved", () => {
  assert.equal(parseLocale("en"), "en");
  assert.equal(parseLocale(" zh-TW "), "zh-TW");
  assert.equal(parseLocale("ja"), null);
  assert.equal(parseLocale(""), null);
  assert.equal(parseLocale(null), null);
});
