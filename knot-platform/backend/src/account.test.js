import assert from "node:assert/strict";
import test from "node:test";
import { BIO_MAX, NAME_MAX, bioText, displayNameText, ownerId, specialtyList, storedSpecialties } from "./account.js";

test("specialties keep the first spelling of each name", () => {
  assert.deepEqual(specialtyList([" 网页搜索 ", "网页搜索", "资料整理"]), ["网页搜索", "资料整理"]);
  assert.deepEqual(specialtyList([]), []);
});

test("a specialty list rejects a paragraph, a comma, or a ninth name", () => {
  assert.throws(() => specialtyList("网页搜索"), (error) => error.code === "bad_specialty");
  assert.throws(() => specialtyList([""]), (error) => error.code === "bad_specialty");
  assert.throws(() => specialtyList(["搜索，下载"]), (error) => error.code === "bad_specialty");
  assert.throws(() => specialtyList(["一二三四五六七八九十一二三四五六七八九十一"]), (error) => error.code === "bad_specialty");
  assert.throws(() => specialtyList(["一", "二", "三", "四", "五", "六", "七", "八", "九"]), (error) => error.code === "bad_specialty");
});

test("a stored specialty list drops anything that is not text", () => {
  assert.deepEqual(storedSpecialties(["网页搜索", "", 1, null]), ["网页搜索"]);
  assert.deepEqual(storedSpecialties(null), []);
});

test("bio keeps newlines but trims outer whitespace", () => {
  assert.equal(bioText(null), "");
  assert.equal(bioText("  一行\n\n两行  "), "一行\n\n两行");
  assert.throws(() => bioText(123), (error) => error.code === "bad_bio");
  assert.throws(() => bioText("a".repeat(BIO_MAX + 1)), (error) => error.code === "bad_bio");
});

test("a display name collapses whitespace and stays non-empty", () => {
  assert.equal(displayNameText("  Paul   Wang "), "Paul Wang");
  assert.equal(displayNameText("用户\n招待"), "用户 招待");
  assert.equal(displayNameText("🙂".repeat(NAME_MAX)), "🙂".repeat(NAME_MAX));
  assert.throws(() => displayNameText(""), (error) => error.code === "bad_name");
  assert.throws(() => displayNameText("   "), (error) => error.code === "bad_name");
  assert.throws(() => displayNameText(null), (error) => error.code === "bad_name");
  assert.throws(() => displayNameText("字".repeat(NAME_MAX + 1)), (error) => error.code === "bad_name");
});

test("the owner lookup answers null instead of failing when the row is missing", async () => {
  const withOwner = { async query() { return { rows: [{ id: "owner-1" }] }; } };
  assert.equal(await ownerId(withOwner), "owner-1");
  const empty = { async query() { return { rows: [] }; } };
  assert.equal(await ownerId(empty), null);
});
