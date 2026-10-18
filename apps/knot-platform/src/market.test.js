import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { saveReviewExtract } from "./extracts.js";
import { compareByWeight, isDownloadableFile, listPublicIntel, noteReviewFailure, presentIntel, publicAuthor, reopenSale, reviewFailureText, saleExpiresAt, saleLive, saleTtlHours, searchPublicIntel } from "./market.js";
import { serviceFee, packetPrice, policyConfig } from "./points.js";

const AUTHOR = "33333333-3333-4333-8333-333333333333";

test("a public card keeps the author account id", () => {
  const card = presentIntel({
    id: "post",
    user_id: AUTHOR,
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
  assert.equal(card.user_id, undefined);
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
  assert.match(calls[0].sql, /AND i\.user_id = \$2/);
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
  assert.match(calls[0].sql, /AND NOT EXISTS \(\s*SELECT 1 FROM intel_files f/);
  await listPublicIntel(pool, 30, null, null, null, { sales: true });
  assert.match(calls[1].sql, /AND EXISTS \(\s*SELECT 1 FROM intel_files f/);
  assert.doesNotMatch(calls[1].sql, /AND NOT EXISTS \(\s*SELECT 1 FROM intel_files f/);
  // 出售栏只留仍在有效期内的记录。
  assert.match(calls[1].sql, /i\.expires_at/);
  assert.match(calls[1].sql, /> now\(\)/);
});

test("search applies the same category and topic filters", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [] };
    },
  };
  await searchPublicIntel(pool, "住房", null, { category: "房产" });
  assert.match(calls[0].sql, /AND i\.category = \$2/);
  assert.deepEqual(calls[0].params, [null, "房产"]);
});

test("a public author is only someone with a visible post", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ id: AUTHOR, display_name: "甲", avatar_upload_id: null }] };
    },
  };
  const author = await publicAuthor(pool, AUTHOR);
  assert.equal(author.id, AUTHOR);
  assert.equal(author.name, "甲");
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
  const id = "23737bf5-537f-441f-bc86-bf230d1cf9ed";
  const userId = "11111111-1111-4111-8111-111111111111";
  const notes = [];
  let detail = null;
  const pool = {
    async query(sql, params) {
      if (sql.includes("SELECT user_id, verdict, detail")) {
        return { rows: [{ user_id: userId, verdict: "pending", detail }] };
      }
      if (sql.includes("UPDATE intel")) {
        detail = { reviewError: JSON.parse(params[1]).reviewError };
        return { rows: [{ user_id: userId }] };
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
  assert.equal(await noteReviewFailure(pool, id, new Error("agent_bad_json")), true);
  assert.equal(notes.length, 2);
  assert.match(notes[1][3], /没有交回可用结果/);
});

test("a finished record does not get a review-failure notice", async () => {
  const pool = {
    async query(sql) {
      if (sql.includes("SELECT user_id, verdict, detail")) {
        return { rows: [{ user_id: "u", verdict: "passed", detail: null }] };
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
      if (sql.includes("AND i.user_id = $2")) {
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
