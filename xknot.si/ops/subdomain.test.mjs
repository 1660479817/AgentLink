import assert from "node:assert/strict";
import test from "node:test";

import { RESERVED_LABELS, SUBDOMAIN_MIN, checkLabel, normalizeLabel, suggestLabels } from "./subdomain.mjs";

test("normalizeLabel 接受整条地址与带后缀的标签", () => {
  assert.equal(normalizeLabel("  Foo-Bar "), "foo-bar");
  assert.equal(normalizeLabel("https://foo-bar.xknot.si/"), "foo-bar");
  assert.equal(normalizeLabel("foo-bar.xknot.si"), "foo-bar");
  assert.equal(normalizeLabel("foo-bar.xknot.si."), "foo-bar");
  assert.equal(normalizeLabel("foo-bar:443"), "foo-bar");
});

test("少于 6 个字符的标签不签，并给出 too_short 而不是 format", () => {
  assert.equal(SUBDOMAIN_MIN, 6);
  const short = checkLabel("abcde");
  assert.equal(short.available, false);
  assert.equal(short.reason, "too_short");
  assert.equal(checkLabel("abcdef").available, true);
});

test("格式规则：小写字母数字与连字符，首尾不能是连字符，不能是 punycode 前缀", () => {
  assert.equal(checkLabel("hello-world").available, true);
  assert.equal(checkLabel("-hello").reason, "format");
  assert.equal(checkLabel("hello-").reason, "format");
  assert.equal(checkLabel("hello_world").reason, "format");
  assert.equal(checkLabel("ab--cd").reason, "format");
  assert.equal(checkLabel("123456").reason, "format");
  assert.equal(checkLabel("a".repeat(40)).reason, "too_long");
});

test("保留词与已占用的标签分开报", () => {
  assert.ok(RESERVED_LABELS.has("status"));
  assert.equal(checkLabel("status").reason, "reserved");
  assert.equal(checkLabel("take-one", { taken: ["TAKE-ONE"] }).reason, "taken");
});

test("候选只在长度足够时给出，并避开已占用的", () => {
  assert.deepEqual(suggestLabels("abc"), []);
  assert.deepEqual(suggestLabels("hello", { taken: ["hello2"] }), ["hello3", "hello4", "hello5"]);
});
