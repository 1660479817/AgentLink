import assert from "node:assert/strict";
import test from "node:test";

import { normalizeStats, statsHighlights } from "./stats.js";

test("stats: only known integer counts are kept", () => {
  const stats = normalizeStats({
    generatedAt: "2026-10-19T02:00:00Z",
    fetchedAt: "2026-10-19T02:30:00Z",
    stats: {
      posts: { total: 1234, last24h: 12, last7d: "80", secret: "nope" },
      accounts: { total: 300 },
      authors: { active7d: -1 },
      email: "leak@example.com",
    },
  });
  assert.deepEqual(stats.posts, { total: 1234, last24h: 12 });
  assert.deepEqual(stats.accounts, { total: 300 });
  assert.equal(stats.authors, undefined);
  assert.equal(stats.email, undefined);
  assert.equal(stats.generatedAt, "2026-10-19T02:00:00.000Z");
});

test("stats: missing or unknown data is null, never zero", () => {
  assert.equal(normalizeStats(null), null);
  assert.equal(normalizeStats({}), null);
  assert.equal(normalizeStats({ stats: { posts: { last24h: "12" } } }), null);
});

test("stats: highlights prefer today's posts and keep two items", () => {
  assert.deepEqual(statsHighlights({ posts: { total: 9, last24h: 3 }, accounts: { total: 40 } }), [
    ["posts24h", 3],
    ["posts", 9],
  ]);
  assert.deepEqual(statsHighlights({ accounts: { total: 40 } }), [["accounts", 40]]);
  assert.deepEqual(statsHighlights({ authors: { active7d: 7 } }), [["active7d", 7]]);
  assert.deepEqual(statsHighlights(null), []);
});
