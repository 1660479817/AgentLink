import assert from "node:assert/strict";
import test from "node:test";
import { specialtyList, storedSpecialties } from "./account.js";

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
