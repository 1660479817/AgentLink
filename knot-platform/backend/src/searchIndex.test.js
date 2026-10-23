import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { saveReviewExtract, discardExtract } from "./extracts.js";
import { refreshSearchIndex, searchIndexOf, searchTextOf } from "./searchIndex.js";

const ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

test("the indexed text is body, note, language, video links and the attachment transcript", () => {
  const text = searchTextOf(
    {
      body: "**开源** 了一个模型",
      detail: { note: "一句话事实", language: "zh" },
      videos: [{ url: "https://video.example/a" }],
    },
    "附件里的文字",
  );
  // 正文按纯文本参与索引：Markdown 的星号不该让「开源」断开。
  assert.match(text, /开源/);
  assert.doesNotMatch(text, /\*\*/);
  assert.match(text, /了一个模型/);
  assert.match(text, /一句话事实/);
  assert.match(text, /zh/);
  assert.match(text, /https:\/\/video\.example\/a/);
  assert.match(text, /附件里的文字/);
});

test("missing fields compose to an empty index instead of the word undefined", () => {
  const text = searchTextOf({ body: "", detail: null, videos: null });
  assert.equal(text, "");
  assert.equal(searchIndexOf(text).compact, "");
  assert.deepEqual(searchIndexOf(text).bigrams, []);
});

test("the index stores the compacted text and its unique bigrams", () => {
  const index = searchIndexOf("住房 住房！");
  assert.equal(index.compact, "住房住房");
  assert.deepEqual(index.bigrams, ["住房", "房住"]);
});

test("refreshing a row writes both index columns", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.startsWith("SELECT")) {
        return { rows: [{ id: ID, body: "求租住房", videos: [], detail: { note: "两居室" } }] };
      }
      return { rows: [] };
    },
  };
  const index = await refreshSearchIndex(pool, ID);
  assert.equal(index.compact, "求租住房两居室");
  assert.match(calls[1].sql, /UPDATE intel SET search_compact = \$2, search_bigrams = \$3::text\[\]/);
  assert.deepEqual(calls[1].params[2], index.bigrams);
});

test("refreshing an unknown or malformed id does nothing", async () => {
  const pool = {
    async query() {
      throw new Error("should not query");
    },
  };
  assert.equal(await refreshSearchIndex(pool, "not-a-uuid"), null);
});

test("the attachment transcript reaches the index and leaves it again", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "knot-index-extract-"));
  const previous = process.env.UPLOAD_DIR;
  process.env.UPLOAD_DIR = dir;
  const written = [];
  const pool = {
    async query(sql, params) {
      if (sql.startsWith("SELECT")) {
        return { rows: [{ id: ID, body: "原稿", videos: [], detail: {} }] };
      }
      written.push(params[1]);
      return { rows: [] };
    },
  };
  try {
    await saveReviewExtract(ID, [{ heading: "图片 1", text: "传感器规格表" }]);
    const withExtract = await refreshSearchIndex(pool, ID);
    assert.match(withExtract.compact, /传感器规格表/);

    await discardExtract(ID);
    const without = await refreshSearchIndex(pool, ID);
    assert.doesNotMatch(without.compact, /传感器规格表/);
    assert.equal(written.length, 2);
  } finally {
    if (previous == null) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
