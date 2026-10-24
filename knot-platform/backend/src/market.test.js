import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { saveReviewExtract } from "./extracts.js";
import { compareByWeight, createIntel, deleteOwnPost, isDownloadableFile, judgeIntel, listPublicIntel, loadPublicIntel, noteReviewFailure, presentIntel, publicAuthor, reopenSale, reviewFailureText, saleExpiresAt, saleLive, saleTtlHours, searchPublicIntel } from "./market.js";
import { clearSearchCache } from "./searchCache.js";
import { serviceFee, packetPrice, policyConfig } from "./points.js";

const AUTHOR = "33333333-3333-4333-8333-333333333333";

test("a public card keeps the author account id", () => {
  const card = presentIntel({
    id: "post",
    account_id: AUTHOR,
    display_name: "甲",
    avatar_upload_id: null,
    body: "原文",
    videos: [],
    links: {},
    kind: "post",
    price: 0,
    is_public: true,
    verdict: "passed",
    created_at: "2026-10-16T00:00:00.000Z",
    updated_at: "2026-10-16T00:00:00.000Z",
  });
  assert.equal(card.author.id, AUTHOR);
  assert.equal(card.author.name, "甲");
  assert.equal(card.account_id, undefined);
});

// 卡片上的累计打赏由查询一次带出来：一条记录一个数，不按卡片再问一次摘要接口。
test("a card carries the tip total, and zero when nobody has tipped", async () => {
  const row = {
    id: "post",
    account_id: AUTHOR,
    display_name: "甲",
    avatar_upload_id: null,
    body: "原文",
    videos: [],
    links: {},
    kind: "post",
    price: 0,
    is_public: true,
    verdict: "passed",
    created_at: "2026-10-16T00:00:00.000Z",
    updated_at: "2026-10-16T00:00:00.000Z",
  };
  assert.equal(presentIntel({ ...row, tip_total: 12 }).tipTotal, 12);
  assert.equal(presentIntel({ ...row, tip_total: null }).tipTotal, 0);
  // 行里没有这一列时（如发布响应）也是 0，不会变成 undefined 传到卡片上。
  assert.equal(presentIntel(row).tipTotal, 0);

  const calls = [];
  await listPublicIntel({ async query(sql, params) { calls.push({ sql, params }); return { rows: [] }; } }, 30);
  assert.match(calls[0].sql, /AS tip_total/);
});

test("an author filter narrows the public feed by account, then time", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [] };
    },
  };
  await listPublicIntel(pool, 30, null, AUTHOR);
  assert.match(calls[0].sql, /AND i\.account_id = \$2/);
  assert.match(calls[0].sql, /ORDER BY i\.created_at DESC, i\.weight DESC, i\.id DESC LIMIT \$3/);
  assert.deepEqual(calls[0].params, [null, AUTHOR, 30]);
});

test("the public feed folds revisions to the newest visible version per origin", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [] };
    },
  };
  await listPublicIntel(pool, 30, null);
  // 同一 origin 只保留最新可见版：排除存在「同 origin、版本更高、且可见」的新版本。
  assert.match(calls[0].sql, /COALESCE\(newer\.origin_id, newer\.id\) = COALESCE\(i\.origin_id, i\.id\)/);
  assert.match(calls[0].sql, /newer\.version > i\.version/);
  assert.match(calls[0].sql, /newer\.verdict IN \('pending', 'passed'\)/);
});

test("a before cursor pages strictly after the anchor, then time and weight", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [] };
    },
  };
  const anchor = "11111111-1111-4111-8111-111111111111";
  await listPublicIntel(pool, 30, null, null, anchor);
  assert.match(calls[0].sql, /\(i\.created_at, i\.weight, i\.id\) < \(/);
  assert.match(calls[0].sql, /SELECT created_at, weight, id FROM intel WHERE id = \$2::uuid/);
  assert.match(calls[0].sql, /ORDER BY i\.created_at DESC, i\.weight DESC, i\.id DESC LIMIT \$3/);
  assert.deepEqual(calls[0].params, [null, anchor, 30]);
});

test("a category and a topic narrow the public feed together", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [] };
    },
  };
  await listPublicIntel(pool, 30, null, null, null, { category: "招聘", topic: "大模型" });
  assert.match(calls[0].sql, /AND i\.category = \$2/);
  assert.match(calls[0].sql, /AND \(i\.detail -> 'topics'\) \? \$3/);
  assert.deepEqual(calls[0].params, [null, "招聘", "大模型", 30]);
});

test("the public feed excludes sales and can be flipped to sales only", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [] };
    },
  };
  await listPublicIntel(pool, 30, null);
  // 零价附件帖留在信息流：只有「有可下载附件且有标价」的才算出售帖被排除。
  assert.match(calls[0].sql, /AND NOT \(\s*EXISTS \(\s*SELECT 1 FROM intel_files f/);
  assert.match(calls[0].sql, /i\.price > 0/);
  await listPublicIntel(pool, 30, null, null, null, { sales: true });
  assert.match(calls[1].sql, /AND \(\s*EXISTS \(\s*SELECT 1 FROM intel_files f/);
  assert.match(calls[1].sql, /i\.price > 0/);
  assert.doesNotMatch(calls[1].sql, /AND NOT \(\s*EXISTS \(\s*SELECT 1 FROM intel_files f/);
  // 出售栏只留仍在有效期内的记录。
  assert.match(calls[1].sql, /i\.expires_at/);
  assert.match(calls[1].sql, /> now\(\)/);
});

test("the list projection carries expires_at so the reader side can show validity", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [] };
    },
  };
  await listPublicIntel(pool, 30, null);
  // 投影里必须带出这一列：card.toRecord 读 row.expires_at，缺了就恒为 null。
  const projection = calls[0].sql.split("FROM intel i")[0];
  assert.match(projection, /i\.expires_at/);
});

test("search applies the same category and topic filters", async () => {
  clearSearchCache();
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [] };
    },
  };
  await searchPublicIntel(pool, "住房", null, { category: "房产" });
  assert.match(calls[0].sql, /AND i\.category = \$2/);
  // $1 是账户，$2 是类别，$3 是查询的二元组，$4 是候选集上限。
  assert.deepEqual(calls[0].params, [null, "房产", ["住房"], 2000]);
  assert.match(calls[0].sql, /i\.search_bigrams && \$3::text\[\]/);
  assert.match(calls[0].sql, /LIMIT \$4/);
});

test("search narrows candidates in SQL instead of pulling the heftiest rows", async () => {
  clearSearchCache();
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [] };
    },
  };
  await searchPublicIntel(pool, "人工智能", null);
  assert.match(calls[0].sql, /i\.search_bigrams && \$2::text\[\]/);
  // 单字查询没有二元组，退回子串匹配，否则一个字的查询永远收不到候选。
  await searchPublicIntel(pool, "高", null);
  assert.match(calls[1].sql, /i\.search_compact LIKE/);
  // 回填未跑完的库也要能搜到：两列还没有值的行保留兜底条件。
  assert.match(calls[0].sql, /i\.search_bigrams IS NULL OR/);
});

test("a cached search still records one event per request", async () => {
  clearSearchCache();
  const inserts = [];
  let selects = 0;
  const pool = {
    async query(sql, params) {
      if (sql.includes("INSERT INTO search_events")) {
        inserts.push(params);
        return { rows: [] };
      }
      selects += 1;
      return { rows: [] };
    },
  };
  const user = "44444444-4444-4444-8444-444444444444";
  await searchPublicIntel(pool, "住房", user);
  await searchPublicIntel(pool, "住房", user);
  await new Promise((resolve) => setImmediate(resolve));
  // 第二次命中缓存，但「有人检索了」这件事要记两次。
  assert.equal(selects, 1);
  assert.equal(inserts.length, 2);
  clearSearchCache();
});

test("a cached row does not carry the index text", async () => {
  clearSearchCache();
  const id = "55555555-5555-4555-8555-555555555555";
  const pool = {
    async query(sql) {
      if (sql.includes("INSERT INTO search_events")) return { rows: [] };
      return {
        rows: [{
          id,
          body: "住房",
          detail: {},
          videos: [],
          weight: 1,
          created_at: "2026-10-16T00:00:00.000Z",
          search_compact: "住房",
        }],
      };
    },
  };
  const found = await searchPublicIntel(pool, "住房", "66666666-6666-4666-8666-666666666666");
  assert.equal(found.length, 1);
  // 打分用的长文本留在检索内部：缓存与响应都不该带上它。
  assert.equal("search_compact" in found[0], false);
  const again = await searchPublicIntel(pool, "住房", "66666666-6666-4666-8666-666666666666");
  assert.equal("search_compact" in again[0], false);
  clearSearchCache();
});

test("a query with no letters or digits skips the database entirely", async () => {
  clearSearchCache();
  let queries = 0;
  const pool = {
    async query() {
      queries += 1;
      return { rows: [] };
    },
  };
  assert.deepEqual(await searchPublicIntel(pool, "！！！", null), []);
  assert.equal(queries, 0);
});

test("a public author is only someone with a visible post", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ id: AUTHOR, display_name: "甲", avatar_upload_id: null, role: "agent" }] };
    },
  };
  const author = await publicAuthor(pool, AUTHOR);
  assert.equal(author.id, AUTHOR);
  assert.equal(author.name, "甲");
  assert.equal(author.role, "agent");
  assert.match(calls[0].sql, /i\.kind IN \('post', 'fastpost'\)/);
  assert.deepEqual(calls[0].params, [AUTHOR]);
  const empty = {
    async query() {
      return { rows: [] };
    },
  };
  assert.equal(await publicAuthor(empty, AUTHOR), null);
});

test("search order is weight, then newer", () => {
  const rows = [
    { weight: 1, created_at: "2026-10-12T00:00:00.000Z", id: "older" },
    { weight: 2, created_at: "2026-10-01T00:00:00.000Z", id: "heavier" },
    { weight: 1, created_at: "2026-10-12T03:00:00.000Z", id: "newer" },
  ];
  assert.deepEqual(rows.sort(compareByWeight).map((row) => row.id), ["heavier", "newer", "older"]);
});

test("search matches text saved from a picture or a file", async () => {
  clearSearchCache();
  const dir = await mkdtemp(path.join(os.tmpdir(), "knot-search-extract-"));
  const previous = process.env.UPLOAD_DIR;
  process.env.UPLOAD_DIR = dir;
  const id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const pool = {
    async query() {
      return {
        rows: [{
          id,
          body: "只有原文",
          detail: {},
          videos: [],
          weight: 1,
          created_at: "2026-10-16T00:00:00.000Z",
        }],
      };
    },
  };
  try {
    await saveReviewExtract(id, [{ heading: "图片 1", text: "传感器规格表" }]);
    const found = await searchPublicIntel(pool, "传感器", null);
    assert.equal(found.length, 1);
    assert.equal(found[0].id, id);
    const missed = await searchPublicIntel(pool, "量子织布机", null);
    assert.equal(missed.length, 0);
  } finally {
    if (previous === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test("text is free and a blank file price uses the default", () => {
  assert.equal(packetPrice(0, 25), 0);
  assert.equal(packetPrice(1, ""), 10);
  assert.equal(packetPrice(1, null), 10);
  assert.equal(packetPrice(2, 0), 0);
  assert.equal(packetPrice(2, 8), 8);
  assert.equal(packetPrice(1, 100), 100);
  assert.throws(() => packetPrice(1, 101), (error) => error.code === "bad_price");
  assert.throws(() => packetPrice(1, 1.5), (error) => error.code === "bad_price");
});

test("a review failure names the exception and says the record stays visible", () => {
  const error = new Error("agent_timeout");
  error.detail = "openclaw timed out";
  const text = reviewFailureText(error);
  assert.match(text, /数据评审员超时/);
  assert.match(text, /agent_timeout/);
  assert.match(text, /openclaw timed out/);
  assert.match(text, /仍然可见/);
});

test("the same review failure is told once, and a new one is told again", async () => {
  const id = "33333333-3333-4333-8333-333333333333";
  const userId = "11111111-1111-4111-8111-111111111111";
  const notes = [];
  let detail = null;
  const pool = {
    async query(sql, params) {
      if (sql.includes("SELECT account_id, verdict, detail")) {
        return { rows: [{ account_id: userId, verdict: "pending", detail }] };
      }
      if (sql.includes("UPDATE intel")) {
        detail = { reviewError: JSON.parse(params[1]).reviewError };
        return { rows: [{ account_id: userId }] };
      }
      if (sql.includes("INSERT INTO notifications")) {
        notes.push(params);
        return { rows: [{ id: "n1" }] };
      }
      return { rows: [] };
    },
  };
  assert.equal(await noteReviewFailure(pool, id, new Error("agent_timeout")), true);
  assert.equal(await noteReviewFailure(pool, id, new Error("agent_timeout")), false);
  assert.equal(notes.length, 1);
  assert.equal(notes[0][1], "intel_review_error");
  assert.equal(notes[0][2], "审核异常");
  assert.match(notes[0][3], /agent_timeout/);
  assert.equal(notes[0][4], "/mine/submissions");
  assert.deepEqual(JSON.parse(notes[0][6]), { code: "agent_timeout", detail: "" });
  assert.equal(await noteReviewFailure(pool, id, new Error("agent_bad_json")), true);
  assert.equal(notes.length, 2);
  assert.match(notes[1][3], /没有交回可用结果/);
});

test("a finished record does not get a review-failure notice", async () => {
  const pool = {
    async query(sql) {
      if (sql.includes("SELECT account_id, verdict, detail")) {
        return { rows: [{ account_id: "u", verdict: "passed", detail: null }] };
      }
      throw new Error("unexpected");
    },
  };
  assert.equal(await noteReviewFailure(pool, "id", new Error("agent_failed")), false);
});

test("policy limits default to the initial platform values", () => {
  const keys = ["KNOT_DEFAULT_PRICE", "KNOT_PRICE_MIN", "KNOT_PRICE_MAX", "KNOT_PUBLISH_SERVICE_FEE_PER_MB", "KNOT_DOWNLOAD_SERVICE_FEE_PER_MB", "KNOT_SERVICE_FEE_CAP", "KNOT_RETRIEVAL_PRICE"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  try {
    assert.deepEqual(policyConfig(), {
      defaultPrice: 10,
      priceMin: 0,
      priceMax: 100,
      publishServiceFeePerMb: 1,
      downloadServiceFeePerMb: 1,
      serviceFeeCap: 10,
      retrievalPrice: 10,
    });
  } finally {
    for (const key of keys) {
      if (previous[key] == null) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test("service fee rounds attachment bytes up per MB and caps", () => {
  assert.equal(serviceFee(0, 1, 10), 0);
  assert.equal(serviceFee(1, 1, 10), 1); // 1 字节也是 1 单位（向上取整）
  assert.equal(serviceFee(1024 * 1024, 1, 10), 1); // 正好 1MB
  assert.equal(serviceFee(1024 * 1024 + 1, 1, 10), 2); // 1MB 出头 → 2
  assert.equal(serviceFee(1024 * 1024 * 3, 1, 10), 3);
  assert.equal(serviceFee(1024 * 1024 * 50, 1, 10), 10); // 封顶
  assert.equal(serviceFee(1024 * 1024 * 2, 0, 10), 0); // 费率 0 免费
  assert.equal(serviceFee(1024 * 1024 * 5, 2, 10), 10); // 5MB×2=10 正好
});

test("a deep link finds the post through its revision chain, not by exact id", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [] };
    },
  };
  const ID = "11111111-1111-4111-8111-111111111111";
  assert.equal(await loadPublicIntel(pool, null, ID), null);
  // 地址认的是整条修订链：旧版本的 id 也落到最新那一版上。
  assert.match(calls[0].sql, /COALESCE\(i\.origin_id, i\.id\) = \(SELECT COALESCE\(origin_id, id\) FROM intel WHERE id = \$2::uuid\)/);
  assert.doesNotMatch(calls[0].sql, /AND i\.id = \$2::uuid/);
  assert.deepEqual(calls[0].params, [null, ID]);
});

test("a sale lasts 72 hours by default, overridable by env", () => {
  const previous = process.env.KNOT_SALE_TTL_HOURS;
  delete process.env.KNOT_SALE_TTL_HOURS;
  try {
    assert.equal(saleTtlHours(), 72);
    assert.equal(saleExpiresAt(Date.UTC(2026, 9, 17, 0, 0, 0)).toISOString(), "2026-10-20T00:00:00.000Z");
  } finally {
    if (previous == null) delete process.env.KNOT_SALE_TTL_HOURS;
    else process.env.KNOT_SALE_TTL_HOURS = previous;
  }
  process.env.KNOT_SALE_TTL_HOURS = "24";
  try {
    assert.equal(saleTtlHours(), 24);
    assert.equal(saleExpiresAt(Date.UTC(2026, 9, 17, 0, 0, 0)).toISOString(), "2026-10-18T00:00:00.000Z");
  } finally {
    if (previous == null) delete process.env.KNOT_SALE_TTL_HOURS;
    else process.env.KNOT_SALE_TTL_HOURS = previous;
  }
});

test("the sale live filter falls back to the platform hours for old rows", () => {
  const sql = saleLive("i");
  assert.match(sql, /i\.expires_at/);
  assert.match(sql, /i\.created_at \+ interval '72 hours'/);
  assert.match(sql, /> now\(\)/);
});

test("a downloadable file is anything that is not an image or audio", () => {
  assert.equal(isDownloadableFile({ mime: "application/pdf", original_name: "report.pdf" }), true);
  assert.equal(isDownloadableFile({ mime: "application/octet-stream", original_name: "data.zip" }), true);
  assert.equal(isDownloadableFile({ mime: "image/png", original_name: "pic.png" }), false);
  assert.equal(isDownloadableFile({ mime: "audio/mpeg", original_name: "song.mp3" }), false);
  assert.equal(isDownloadableFile({ mime: "application/octet-stream", original_name: "voice.wav" }), false);
  assert.equal(isDownloadableFile({ mime: "", original_name: "notes.md" }), true);
});

test("reopening a sale resets its expiry to the platform hours", async () => {
  const intelId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const userId = "11111111-1111-4111-8111-111111111111";
  const updates = [];
  const pool = {
    async query(sql, params) {
      if (sql.includes("UPDATE intel SET expires_at")) {
        updates.push(params);
        return { rows: [] };
      }
      if (sql.includes("AND i.account_id = $2")) {
        return { rows: [{ id: intelId }] };
      }
      return { rows: [] };
    },
  };
  await reopenSale(pool, userId, intelId);
  assert.equal(updates.length, 1);
  assert.equal(updates[0][0], intelId);
  const at = new Date(updates[0][1]);
  const expected = Date.now() + 72 * 60 * 60 * 1000;
  assert.ok(Math.abs(at.getTime() - expected) < 60 * 1000);
});

test("reopening is refused for someone else's post or a non-sale", async () => {
  const pool = {
    async query() {
      return { rows: [] };
    },
  };
  await assert.rejects(() => reopenSale(pool, "11111111-1111-4111-8111-111111111111", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), (error) => error.code === "not_found");
});

const POST_V1 = "55555555-5555-4555-8555-555555555555";
const POST_V2 = "66666666-6666-4666-8666-666666666666";
const POST_ORIGIN = "44444444-4444-4444-8444-444444444444";

test("deleting a post keeps the row and takes the whole revision chain down", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("SELECT id, account_id, kind, origin_id, verdict")) {
        return { rows: [{ id: POST_V2, account_id: AUTHOR, kind: "post", origin_id: POST_ORIGIN, verdict: "passed" }] };
      }
      if (sql.includes("UPDATE intel")) return { rows: [{ id: POST_V1 }, { id: POST_V2 }] };
      return { rows: [] };
    },
  };
  const result = await deleteOwnPost(pool, AUTHOR, POST_V2);
  assert.deepEqual(result, { ok: true, already: false, id: POST_V2 });
  const update = calls.find((call) => call.sql.includes("UPDATE intel"));
  assert.match(update.sql, /verdict = 'removed'/);
  assert.match(update.sql, /is_public = false/);
  assert.match(update.sql, /COALESCE\(origin_id, id\) = COALESCE\(\$2::uuid, \$1::uuid\)/);
  assert.deepEqual(update.params, [POST_V2, POST_ORIGIN]);
});

test("deleting is quiet for someone else's post, another kind, or an already deleted one", async () => {
  const other = {
    async query(sql) {
      if (sql.includes("SELECT id, account_id, kind, origin_id, verdict")) {
        return { rows: [{ id: POST_V2, account_id: "22222222-2222-4222-8222-222222222222", kind: "post", origin_id: null, verdict: "passed" }] };
      }
      throw new Error("should not update");
    },
  };
  await assert.rejects(deleteOwnPost(other, AUTHOR, POST_V2), (error) => error.code === "not_found");

  const wish = {
    async query(sql) {
      if (sql.includes("SELECT id, account_id, kind, origin_id, verdict")) {
        return { rows: [{ id: POST_V2, account_id: AUTHOR, kind: "wish", origin_id: null, verdict: "passed" }] };
      }
      throw new Error("should not update");
    },
  };
  await assert.rejects(deleteOwnPost(wish, AUTHOR, POST_V2), (error) => error.code === "bad_state");

  const gone = {
    async query(sql) {
      if (sql.includes("SELECT id, account_id, kind, origin_id, verdict")) {
        return { rows: [{ id: POST_V2, account_id: AUTHOR, kind: "post", origin_id: null, verdict: "removed" }] };
      }
      if (sql.includes("UPDATE intel")) return { rows: [] };
      throw new Error(sql);
    },
  };
  assert.deepEqual(await deleteOwnPost(gone, AUTHOR, POST_V2), { ok: true, already: true, id: POST_V2 });
});


test("a review that blows up still lands the transcript it already wrote into the index", async () => {
  // 评审员先把转写写盘，再交回结果。它超时或崩掉时，索引也必须跟着磁盘上的内容重算一次，
  // 否则这一行永远少一段文字（search_bigrams 不为 NULL，兜底条件也救不回来）。
  const id = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const updates = [];
  const pool = {
    async query(sql, params) {
      if (sql.startsWith("UPDATE intel SET search_compact")) {
        updates.push(params);
        return { rows: [] };
      }
      if (sql.startsWith("SELECT id, account_id, body")) {
        return {
          rows: [{
            id,
            account_id: AUTHOR,
            body: "正文",
            videos: [],
            links: {},
            verdict: "pending",
            kind: "post",
            responds_to: null,
          }],
        };
      }
      if (sql.startsWith("SELECT id, body, videos, detail")) {
        return { rows: [{ id, body: "正文", videos: [], detail: null }] };
      }
      return { rows: [] };
    },
  };
  const before = { agent: process.env.OPENCLAW_INTEL_AGENT, bin: process.env.OPENCLAW_BIN };
  process.env.OPENCLAW_INTEL_AGENT = "test-agent";
  process.env.OPENCLAW_BIN = path.join(os.tmpdir(), "knot-no-such-openclaw-binary");
  try {
    await assert.rejects(() => judgeIntel(pool, id));
  } finally {
    if (before.agent === undefined) delete process.env.OPENCLAW_INTEL_AGENT;
    else process.env.OPENCLAW_INTEL_AGENT = before.agent;
    if (before.bin === undefined) delete process.env.OPENCLAW_BIN;
    else process.env.OPENCLAW_BIN = before.bin;
  }
  assert.equal(updates.length, 1);
  assert.match(String(updates[0][1]), /正文/);
});

// 重试要安全：Agent 超时重发同一条，平台该把原来那条还给它，而不是报错或再发一条。
// 原来查重写的是 `verdict <> 'pending'`，而刚提交的那条恰恰是 pending——
// 最需要幂等的那一刻不幂等。库里对 (account_id, content_hash) 还有唯一索引，
// 于是重发不是「变成两条」，而是直接撞唯一约束。这条测试盯住那条分界线。
test("a retry of a still-pending post returns the original instead of inserting again", async () => {
  const seen = [];
  const pendingRow = {
    id: "post-pending",
    account_id: AUTHOR,
    actor: "person",
    body: "同一条内容",
    videos: [],
    links: {},
    content_hash: "h",
    detail: null,
    verdict: "pending",
    reject_reason: null,
    category: "",
    price: 0,
    is_public: true,
    kind: "post",
    responds_to: null,
    weight: 0,
    created_at: "2026-10-16T00:00:00.000Z",
    updated_at: "2026-10-16T00:00:00.000Z",
    expires_at: null,
    origin_id: null,
    version: 1,
  };
  const pool = {
    async query(sql, params) {
      seen.push(sql.trim().split("\n")[0]);
      if (/FROM accounts a/.test(sql)) return { rows: [{ id: AUTHOR, role: "person", owner_id: null, muted_until: null }] };
      if (/^SELECT id FROM intel/.test(sql.trim())) return { rows: [{ id: pendingRow.id }] };
      if (/FROM intel WHERE id = \$1/.test(sql)) return { rows: [pendingRow] };
      if (/FROM intel_files/.test(sql)) return { rows: [] };
      throw new Error(`重试路径不该走到这条 SQL：${sql.slice(0, 80)}`);
    },
    async connect() {
      throw new Error("重试路径不该开事务：没有新行要写");
    },
  };

  const card = await createIntel(pool, {
    userId: AUTHOR,
    actor: "person",
    door: "webui",
    kind: "post",
    body: "同一条内容",
    isPublic: true,
  });

  assert.equal(card.id, "post-pending");
  assert.equal(
    seen.some((sql) => sql.startsWith("INSERT INTO intel")),
    false,
    "命中已有记录时不得再插入"
  );
});

// 查重只认存活记录。被否决/撤下的内容，作者应当能原样再发一次；
// 库里的唯一索引也只覆盖 pending / passed，两处口径必须一致。
test("the duplicate check only counts records that are still live", async () => {
  const seen = [];
  const pool = {
    async query(sql) {
      seen.push(sql);
      if (/FROM accounts a/.test(sql)) return { rows: [{ id: AUTHOR, role: "person", owner_id: null, muted_until: null }] };
      if (/^SELECT id FROM intel/.test(sql.trim())) return { rows: [] };
      throw new Error(`预期在查重后停下，却走到：${sql.slice(0, 60)}`);
    },
    async connect() {
      throw new Error("预期在查重后停下");
    },
  };
  await assert.rejects(
    createIntel(pool, { userId: AUTHOR, actor: "person", door: "webui", kind: "post", body: "重发", isPublic: true })
  );
  const dedup = seen.find((sql) => /^SELECT id FROM intel/.test(sql.trim()));
  assert.match(dedup, /verdict IN \('pending', 'passed'\)/);
  assert.doesNotMatch(dedup, /verdict <> 'pending'/);
});

// 修订版本号必须在同一个事务里、锁住 origin 行之后再取：两笔并发修订各自
// 「查 MAX 再 +1」会拿到同一个号，而信息流只按 version 大小去重，同号的两版会同时留在流里。
test("a revision takes its version under the origin row lock, inside the publish transaction", async () => {
  const base = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const origin = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const clientSteps = [];
  const poolSteps = [];
  const client = {
    async query(sql, params) {
      clientSteps.push({ sql, params });
      if (sql === "BEGIN" || sql === "ROLLBACK" || sql === "COMMIT") return { rows: [] };
      if (sql.includes("FOR UPDATE")) return { rows: [{ id: origin }] };
      if (sql.includes("MAX(version)")) return { rows: [{ v: 4 }] };
      if (sql.startsWith("INSERT INTO intel")) return { rows: [] };
      return { rows: [] };
    },
    release() {},
  };
  const pool = {
    async query(sql, params) {
      poolSteps.push({ sql, params });
      if (/FROM accounts a/.test(sql)) return { rows: [{ id: AUTHOR, owner_id: null, muted_until: null }] };
      if (sql.includes("SELECT id, account_id, origin_id, version")) {
        return { rows: [{ id: base, account_id: AUTHOR, origin_id: origin, version: 4 }] };
      }
      if (sql.startsWith("SELECT id FROM intel")) return { rows: [] };
      return { rows: [] };
    },
    async connect() {
      return client;
    },
  };
  await assert.rejects(
    createIntel(pool, { userId: AUTHOR, actor: "person", door: "webui", kind: "post", body: "修订", revises: base, isPublic: true })
  );
  const lockAt = clientSteps.findIndex((step) => step.sql.includes("FOR UPDATE"));
  const maxAt = clientSteps.findIndex((step) => step.sql.includes("MAX(version)"));
  assert.ok(lockAt >= 0, "修订要先锁 origin 行");
  assert.ok(maxAt > lockAt, "取号必须在锁之后");
  // 取号不能留在事务外：连接池上不应再看到这条查询。
  assert.equal(poolSteps.some((step) => step.sql.includes("MAX(version)")), false);
  const insert = clientSteps.find((step) => step.sql.startsWith("INSERT INTO intel"));
  assert.equal(insert.params[12], origin);
  assert.equal(insert.params[13], 5);
});

// 只有外链附件的帖子填了价，价格会被 packetPrice(0, …) 静默抹成 0。宁可直接报错，
// 也不要给出一张「有附件、标了价、其实不卖」的卡片。
test("a price on a post with only external attachments is refused, not silently zeroed", async () => {
  const pool = {
    async query(sql) {
      if (/FROM accounts a/.test(sql)) return { rows: [{ id: AUTHOR, owner_id: null, muted_until: null }] };
      if (sql.startsWith("SELECT id FROM intel")) return { rows: [] };
      return { rows: [] };
    },
    async connect() {
      throw new Error("价格校验不该走到事务");
    },
  };
  await assert.rejects(
    createIntel(pool, {
      userId: AUTHOR,
      actor: "person",
      door: "webui",
      kind: "post",
      body: "只有外链附件",
      fileUrls: ["https://example.com/report.pdf"],
      price: 20,
      isPublic: true,
    }),
    (error) => error.code === "bad_price"
  );
});

// 管理端的「重新终审」或并发重入会拿到一条已经终审过的记录。这条路径也要装配附件，
// 否则返回的卡片没有图片与附件，只有行上的字段。
test("re-judging a settled record returns the same assembled card", async () => {
  const id = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const pool = {
    async query(sql) {
      if (sql.includes("SELECT id, account_id, body, videos, links, verdict, kind, responds_to")) {
        return { rows: [{ id, account_id: AUTHOR, body: "正文", videos: [], links: {}, verdict: "passed", kind: "post", responds_to: null }] };
      }
      if (sql.includes("FROM intel WHERE id = $1")) {
        return {
          rows: [{
            id,
            account_id: AUTHOR,
            actor: "person",
            body: "正文",
            videos: [],
            links: {},
            content_hash: "h",
            detail: null,
            verdict: "passed",
            reject_reason: null,
            category: "",
            price: 0,
            is_public: true,
            kind: "post",
            responds_to: null,
            weight: 0,
            created_at: "2026-10-16T00:00:00.000Z",
            updated_at: "2026-10-16T00:00:00.000Z",
            expires_at: null,
            origin_id: null,
            version: 1,
          }],
        };
      }
      if (sql.includes("FROM intel_files")) {
        return {
          rows: [{
            intel_id: id,
            id: "99999999-9999-4999-8999-999999999999",
            mime: "application/pdf",
            original_name: "报告.pdf",
            size: 1024,
            width: null,
            height: null,
          }],
        };
      }
      throw new Error(`不该走到这条 SQL：${sql.slice(0, 60)}`);
    },
  };
  const card = await judgeIntel(pool, id);
  assert.equal(card.id, id);
  assert.equal(card.attachments.length, 1);
  assert.equal(card.attachments[0].name, "报告.pdf");
  assert.equal(card.kMeta.verdict, "passed");
});

test("a missing record is judged as nothing, not an empty card", async () => {
  const pool = {
    async query() {
      return { rows: [] };
    },
  };
  assert.equal(await judgeIntel(pool, "12121212-1212-4212-8212-121212121212"), null);
});
