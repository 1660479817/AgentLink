import test from "node:test";
import assert from "node:assert/strict";
import { buildDeferredSql, buildInsertSql, buildSelectSql, detectSchema, encodeValue } from "./import-legacy-content.mjs";

test("detect: users 来源配 accounts 目标才算能搬", () => {
  assert.deepEqual(detectSchema({ sourceUsers: "users", sourceAccounts: null, targetAccounts: "accounts" }), {
    source: "legacy",
    target: "accounts",
  });
  // 来源已经是新结构：没什么可搬的。
  assert.equal(detectSchema({ sourceUsers: null, sourceAccounts: "accounts", targetAccounts: "accounts" }).source, "accounts");
  // 目标还没迁移：先跑 migrate.js。
  assert.equal(detectSchema({ sourceUsers: "users", targetAccounts: null }).target, "unknown");
  // 连 users 都没有：连接串指错了库。
  assert.equal(detectSchema({}).source, "unknown");
});

test("select: 来源列在读取时就改成新名字", () => {
  const sql = buildSelectSql({ table: "intel", columns: ["id", "account_id", "body"] });
  assert.equal(sql, 'SELECT "id" AS "id", "user_id" AS "account_id", "body" AS "body" FROM public."intel"');
});

test("select: admin_actions 的两个账号列都改名", () => {
  const sql = buildSelectSql({ table: "admin_actions", columns: ["id", "account_id", "actor_account_id"] });
  assert.match(sql, /"user_id" AS "account_id"/);
  assert.match(sql, /"actor_id" AS "actor_account_id"/);
});

test("insert: 分批占位参数从 1 数到列数×行数", () => {
  const sql = buildInsertSql({ table: "intel", columns: ["id", "account_id", "body"], rowCount: 2 });
  assert.match(sql, /VALUES \(\$1, \$2, \$3\), \(\$4, \$5, \$6\)/);
  assert.match(sql, /ON CONFLICT DO NOTHING/);
  assert.equal(buildInsertSql({ table: "intel", columns: ["id"], rowCount: 0 }), null);
});

test("deferred: 整表插完之后只补非空的那几条", () => {
  const sql = buildDeferredSql({ table: "intel", deferred: ["responds_to", "origin_id"], rowCount: 1 });
  assert.match(sql, /UPDATE public\."intel" AS t/);
  assert.match(sql, /"responds_to" = v\."responds_to", "origin_id" = v\."origin_id"/);
  assert.match(sql, /VALUES \(\$1::uuid, \$2::uuid, \$3::uuid\)\) AS v\("id", "responds_to", "origin_id"\)/);
  assert.match(sql, /v\."responds_to" IS NOT NULL OR v\."origin_id" IS NOT NULL/);
  assert.equal(buildDeferredSql({ table: "intel", deferred: [], rowCount: 1 }), null);
  assert.equal(buildDeferredSql({ table: "intel", deferred: ["responds_to"], rowCount: 0 }), null);
});

test("jsonb: 标量字符串要补回引号，对象原样序列化，null 仍是 null", () => {
  // 库里存的是 jsonb 的 `"abc"`，driver 读成 JS 字符串；直接回写会少引号。
  assert.equal(encodeValue("abc", { json: true }), '"abc"');
  assert.equal(encodeValue({ topics: ["AI"] }, { json: true }), '{"topics":["AI"]}');
  assert.equal(encodeValue(["a", "b"], { json: true }), '["a","b"]');
  assert.equal(encodeValue(12, { json: true }), "12");
  assert.equal(encodeValue(null, { json: true }), null);
  // 非 json 列不动。
  assert.equal(encodeValue("abc", { json: false }), "abc");
  assert.equal(encodeValue(0), 0);
});
