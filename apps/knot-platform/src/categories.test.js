import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CATEGORIES, normalizeCategory } from "./categories.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const migration = fs.readFileSync(path.join(here, "..", "migrations", "020_normalize_categories.sql"), "utf8");

test("the controlled table is a fixed list with a fallback", () => {
  assert.equal(CATEGORIES.length, 18);
  assert.equal(CATEGORIES[CATEGORIES.length - 1], "其他");
  assert.ok(CATEGORIES.includes("AI"));
  assert.ok(CATEGORIES.includes("科技"));
});

test("a controlled category passes through unchanged", () => {
  for (const category of CATEGORIES) {
    assert.equal(normalizeCategory(category), category);
  }
});

// 「房产」「美食」这类名字本身不含关键词，归一规则若不做白名单就会把它们误归「其他」。
// 迁移和运行时规则各写一份，靠这条断言防止两边走散。
test("the migration leaves every controlled category as it is", () => {
  const guard = migration.match(/WHEN category IN \(([\s\S]*?)\) THEN category/);
  assert.ok(guard, "migration has no guard for controlled categories");
  for (const category of CATEGORIES) {
    assert.ok(guard[1].includes(`'${category}'`), `${category} is missing from the migration guard`);
  }
});

test("blank stays blank instead of becoming 其他", () => {
  assert.equal(normalizeCategory(""), "");
  assert.equal(normalizeCategory("   "), "");
  assert.equal(normalizeCategory(null), "");
});

test("synonymous free text folds into one controlled category", () => {
  for (const raw of ["AI资讯", "AI 资讯", "AI技术资讯", "AI模型资讯", "AI行业资讯", "AI新闻"]) {
    assert.equal(normalizeCategory(raw), "AI");
  }
  for (const raw of ["科技资讯", "科技新闻", "科技文章", "技术文章", "技术资讯"]) {
    assert.equal(normalizeCategory(raw), "科技");
  }
});

test("cross-field values are pinned before keyword rules", () => {
  assert.equal(normalizeCategory("AI医疗"), "健康");
  assert.equal(normalizeCategory("模型定价"), "财经");
  assert.equal(normalizeCategory("企业软件并购"), "财经");
  assert.equal(normalizeCategory("体育商业"), "体育");
  assert.equal(normalizeCategory("体育财经"), "体育");
  assert.equal(normalizeCategory("汽车科技"), "汽车");
});

test("review noise folds into 其他", () => {
  for (const raw of ["测试", "图像测试", "连接测试", "系统自检", "测试帖", "实测记录", "自我介绍", "新闻", "评论", "行业观察"]) {
    assert.equal(normalizeCategory(raw), "其他");
  }
});

test("long-tail themes land on their controlled bucket", () => {
  assert.equal(normalizeCategory("数据求购"), "求购");
  assert.equal(normalizeCategory("文案需求"), "求购");
  assert.equal(normalizeCategory("酒店探店"), "美食");
  assert.equal(normalizeCategory("餐饮门店"), "美食");
  assert.equal(normalizeCategory("旅遊"), "旅游");
  assert.equal(normalizeCategory("动漫"), "动漫娱乐");
  assert.equal(normalizeCategory("宠物用品推广"), "宠物");
  assert.equal(normalizeCategory("时尚穿搭"), "时尚");
  assert.equal(normalizeCategory("知识科普"), "教育");
  assert.equal(normalizeCategory("插画"), "设计");
  assert.equal(normalizeCategory("生活分享"), "生活");
  assert.equal(normalizeCategory("汇率分析"), "财经");
});
