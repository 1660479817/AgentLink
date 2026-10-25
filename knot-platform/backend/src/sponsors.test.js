import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { adminRouter } from "./routes/admin.js";
import {
  createSponsor,
  listSponsors,
  placeSponsor,
  removeSponsor,
  sponsorHref,
  sponsorImage,
  SPONSOR_LIMIT,
  updateSponsor,
} from "./sponsors.js";

const FIRST = "11111111-1111-4111-8111-111111111111";
const SECOND = "22222222-2222-4222-8222-222222222222";
const THIRD = "33333333-3333-4333-8333-333333333333";

test("a sponsor link is a site path or an http address", () => {
  assert.equal(sponsorHref("/store"), "/store");
  assert.equal(sponsorHref("https://example.com/a"), "https://example.com/a");
  assert.throws(() => sponsorHref("//evil.example"), (error) => error.code === "bad_href");
  assert.throws(() => sponsorHref("javascript:alert(1)"), (error) => error.code === "bad_href");
  assert.throws(() => sponsorHref(""), (error) => error.code === "bad_href");
});

// 会开事务的写操作先 pool.connect() 再发语句；假池把同一个 query 交给「客户端」。
function transactionalPool(query) {
  const calls = [];
  const run = async (sql, params = []) => {
    calls.push({ sql, params });
    return query(sql, params);
  };
  return {
    calls,
    query(sql, params) {
      throw new Error(`unexpected pool.query: ${sql}`);
    },
    async connect() {
      return { query: run, release() {} };
    },
  };
}

test("creating a sponsor appends it", async () => {
  const pool = transactionalPool(async (sql, params) => {
    if (sql.includes("count(*)")) return { rows: [{ n: 1, max: 1 }] };
    return { rows: [{ id: SECOND, title: params[0], href: params[1], position: params[2] }] };
  });
  const sponsor = await createSponsor(pool, { title: "  一则  赞助  ", href: "https://example.com" });
  assert.equal(sponsor.title, "一则 赞助");
  assert.equal(sponsor.position, 2);
  assert.match(pool.calls[1].sql, /pg_advisory_xact_lock/, "先取锁再计数");
  assert.match(pool.calls[3].sql, /INSERT INTO sponsors/);
});

test("the rail stops at the limit", async () => {
  const pool = transactionalPool(async () => ({ rows: [{ n: SPONSOR_LIMIT, max: SPONSOR_LIMIT }] }));
  await assert.rejects(createSponsor(pool, { title: "满了", href: "/store" }), (error) => error.code === "sponsor_full");
  assert.equal(pool.calls.some((call) => call.sql === "ROLLBACK"), true, "拒绝后回滚");
});

test("an update keeps the fields the caller left out", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ id: FIRST, title: "store", href: params[1], position: 1 }] };
    },
  };
  const sponsor = await updateSponsor(pool, FIRST, { href: "/stars" });
  assert.equal(sponsor.href, "/stars");
  assert.match(calls[0].sql, /href = \$2/);
  assert.doesNotMatch(calls[0].sql, /title =/);
  await assert.rejects(updateSponsor(pool, FIRST, {}), (error) => error.code === "bad_body");
});

test("placing a sponsor rewrites the order", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("SELECT id")) return { rows: [{ id: FIRST }, { id: SECOND }, { id: THIRD }] };
      return { rows: [] };
    },
  };
  const result = await placeSponsor(pool, THIRD, 1);
  assert.equal(result.position, 1);
  assert.deepEqual(calls[1].params[0], [THIRD, FIRST, SECOND]);
  assert.deepEqual(calls[1].params[1], [1, 2, 3]);
});

test("removing a missing sponsor is not found", async () => {
  const pool = { async query() { return { rows: [] }; } };
  await assert.rejects(removeSponsor(pool, FIRST), (error) => error.code === "not_found");
});

test("the public list omits position", async () => {
  const pool = {
    async query() {
      return { rows: [{ id: FIRST, title: "store", href: "/store", position: 1 }] };
    },
  };
  assert.deepEqual(await listSponsors(pool), [{ id: FIRST, title: "store", href: "/store", image: null, caption: "", source: "" }]);
});

test("a stored sponsor picture is served as the display rendition", async () => {
  const pool = {
    async query() {
      return { rows: [{ id: FIRST, title: "store", href: "/store", image_upload_id: SECOND }] };
    },
  };
  const [sponsor] = await listSponsors(pool);
  assert.equal(sponsor.image, `/api/web/uploads/${SECOND}/display`);
});

test("a sponsor picture is an http address or a stored image", async () => {  const pool = {
    async query(sql) {
      if (sql.includes("FROM uploads")) return { rows: [{ id: SECOND }] };
      return { rows: [] };
    },
  };
  assert.deepEqual(await sponsorImage(pool, "https://example.com/a.jpg"), {
    imageUrl: "https://example.com/a.jpg",
    imageUploadId: null,
  });
  assert.deepEqual(await sponsorImage(pool, ""), { imageUrl: null, imageUploadId: null });
  assert.deepEqual(await sponsorImage(pool, `/api/web/uploads/${SECOND}`), { imageUrl: null, imageUploadId: SECOND });
  await assert.rejects(sponsorImage(pool, "/store"), (error) => error.code === "bad_image");
  await assert.rejects(sponsorImage({ async query() { return { rows: [] }; } }, SECOND), (error) => error.code === "bad_image");
});

test("clearing the picture and writing a caption stay on that card", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return {
        rows: [{
          id: FIRST,
          title: "store",
          href: "/store",
          position: 1,
          image_url: null,
          image_upload_id: null,
          caption: params[3],
          source: "",
        }],
      };
    },
  };
  const sponsor = await updateSponsor(pool, FIRST, { image: "", caption: "一句说明" });
  assert.equal(sponsor.image, null);
  assert.equal(sponsor.caption, "一句说明");
  assert.match(calls[0].sql, /image_url = \$2/);
  assert.equal(calls[0].params[1], null);
  assert.equal(calls[0].params[2], null);
  assert.equal(calls[0].params[3], "一句说明");
});

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

test("the admin door rejects a sponsor without a title", async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/admin", adminRouter({ pool: { query: async () => ({ rows: [] }) }, token: "secret" }));
  const server = await listen(app);
  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/sponsors`, {
      method: "POST",
      headers: { Authorization: "Bearer secret", "Content-Type": "application/json" },
      body: JSON.stringify({ href: "/store" }),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "bad_body");
  } finally {
    server.close();
  }
});
