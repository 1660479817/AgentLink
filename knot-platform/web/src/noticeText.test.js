import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createNoticeText } from "./noticeText.js";

const dir = path.dirname(fileURLToPath(import.meta.url));

function translator(name) {
  const messages = JSON.parse(fs.readFileSync(path.join(dir, "i18n", "locales", `${name}.json`), "utf8"));
  return (key, vars) => {
    let text = key.split(".").reduce((node, part) => node?.[part], messages);
    if (typeof text !== "string") return key;
    if (vars) for (const [name, value] of Object.entries(vars)) text = text.replaceAll(`{${name}}`, String(value));
    return text;
  };
}

function notice(name) {
  return createNoticeText(translator(name), () => name);
}

test("titles follow the interface language, not the stored Chinese text", () => {
  const item = { kind: "intel_removed", title: "帖子已删除" };
  assert.equal(notice("en").noticeTitle(item), "Post deleted");
  assert.equal(notice("zh-TW").noticeTitle(item), "貼文已刪除");
  assert.equal(notice("zh-CN").noticeTitle(item), "帖子已删除");
});

test("a kind the catalog does not know keeps the stored text", () => {
  assert.equal(notice("en").noticeTitle({ kind: "something_new", title: "平台新动作" }), "平台新动作");
});

test("bodies are rebuilt from data and keep the human-written note", () => {
  const en = notice("en");
  assert.equal(
    en.noticeBody({ kind: "points_granted", body: "到账 100。活动奖励", data: { amount: 100, note: "活动奖励" } }),
    "Credited 100 points. 活动奖励"
  );
  assert.equal(
    en.noticeBody({ kind: "level_changed", body: "现在是 3。活动奖励", data: { level: 3, note: "活动奖励" } }),
    "Now level 3. 活动奖励"
  );
  assert.equal(
    en.noticeBody({ kind: "entitled", body: "旧正文", data: { granted: ["蓝标", "荣誉"], revoked: ["旧名"], note: "" } }),
    "Granted: 蓝标, 荣誉. Revoked: 旧名."
  );
  assert.equal(
    en.noticeBody({ kind: "tip", body: "旧正文", data: { giver: null, amount: 10 } }),
    "Someone tipped you 10 points."
  );
});

test("platform wording is translated while the author's reason stays as written", () => {
  const en = notice("en");
  assert.equal(en.noticeBody({ kind: "intel_removed", body: "平台关闭", data: { platformClosed: true } }), "Closed by the platform.");
  assert.equal(en.noticeBody({ kind: "intel_removed", body: "含有欺诈内容。", data: { reason: "含有欺诈内容。" } }), "含有欺诈内容。");
  assert.equal(en.noticeBody({ kind: "warning", body: "别再发重复的", data: { note: "别再发重复的" } }), "别再发重复的");
});

test("review failures name the failure and keep the record explanation", () => {
  const en = notice("en");
  assert.equal(
    en.noticeBody({ kind: "intel_review_error", body: "旧正文", data: { code: "agent_timeout", detail: "" } }),
    "the review agent timed out (agent_timeout). This post stays visible and will be reviewed again later."
  );
  assert.equal(
    en.noticeBody({ kind: "intel_review_error", body: "旧正文", data: { code: "unknown_code", detail: "" } }),
    "the review did not finish (unknown_code). This post stays visible and will be reviewed again later."
  );
});

test("a record written before data existed shows its stored text", () => {
  assert.equal(notice("en").noticeBody({ kind: "points_granted", body: "到账 100。活动奖励" }), "到账 100。活动奖励");
  assert.equal(
    notice("zh-CN").noticeBody({ kind: "muted", body: "旧正文", data: { until: "2026-10-24T12:00:00.000Z", note: "原因" } }).startsWith("禁言至 "),
    true
  );
});
