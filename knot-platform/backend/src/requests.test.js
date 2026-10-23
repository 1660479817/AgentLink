import assert from "node:assert/strict";
import test from "node:test";
import { listLooks, listMyResponses, listRequestResponses, listRequests } from "./requests.js";

const ME = "11111111-1111-4111-8111-111111111111";
const WISH = "22222222-2222-4222-8222-222222222222";

// 只收 SQL、固定回空行：这些用例盯的是查询本身的边界（LIMIT、可见性谓词、权限），
// 不是数据的组装。
function recordingPool(handler = () => ({ rows: [] })) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return handler(sql, params) || { rows: [] };
    },
  };
}

test("the wish board is bounded and only shows live wishes", async () => {
  const pool = recordingPool();
  assert.deepEqual(await listRequests(pool, ME), []);
  assert.equal(pool.calls.length, 1);
  assert.match(pool.calls[0].sql, /i\.verdict IN \('pending', 'passed'\)/);
  assert.match(pool.calls[0].sql, /ORDER BY i\.created_at DESC\s+LIMIT 100/);
});

test("my responses and the looks list are bounded too", async () => {
  const responses = recordingPool();
  assert.deepEqual(await listMyResponses(responses, ME), []);
  assert.match(responses.calls[0].sql, /ORDER BY r\.created_at DESC\s+LIMIT 100/);

  const looks = recordingPool();
  assert.deepEqual(await listLooks(looks, ME), []);
  assert.match(looks.calls[0].sql, /ORDER BY l\.created_at DESC\s+LIMIT 100/);
});

test("a wish's responses are limited and keep the same visibility rule", async () => {
  const pool = recordingPool((sql) => {
    if (sql.includes("account_id = $2 AND kind = 'wish'")) return { rows: [{ id: WISH }] };
    return { rows: [] };
  });
  assert.deepEqual(await listRequestResponses(pool, ME, WISH), { responses: [] });
  const listSql = pool.calls[1].sql;
  assert.match(listSql, /verdict IN \('pending', 'passed'\)/);
  assert.match(listSql, /LIMIT 200/);
});

test("someone else's wish responses are not readable", async () => {
  const pool = recordingPool();
  assert.deepEqual(await listRequestResponses(pool, ME, WISH), { error: "not_found", status: 404 });
  // 只查了归属，没有继续取响应。
  assert.equal(pool.calls.length, 1);
});

test("a wish board row is unmarked for its owner and locked for everyone else", async () => {
  const row = {
    id: WISH,
    body: "想找一份报告",
    videos: [],
    links: {},
    content_hash: "h",
    detail: {},
    verdict: "passed",
    price: 0,
    category: "",
    kind: "wish",
    is_public: false,
    account_id: ME,
    actor: "person",
    created_at: "2026-10-16T00:00:00.000Z",
    updated_at: "2026-10-16T00:00:00.000Z",
    expires_at: null,
    response_count: 3,
    unlocked: true,
  };
  const pool = recordingPool(() => ({ rows: [row] }));
  const mine = await listRequests(pool, ME);
  assert.equal(mine[0].mine, true);
  assert.equal(mine[0].unlocked, true);
  assert.equal(mine[0].responseCount, 3);

  const other = await listRequests(pool, "33333333-3333-4333-8333-333333333333");
  assert.equal(other[0].mine, false);
  // 响应数只给发布者看：别人的 wish 有几条响应不该从列表里泄漏。
  assert.equal(other[0].responseCount, 0);
});
