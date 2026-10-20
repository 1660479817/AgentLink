import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  FetchGuardError,
  assertPublicUrl,
  isPublicAddress,
  safeGetJson,
} from "./fetch-guard.mjs";
import { cleanCardsPayload } from "./fetch-cards.mjs";
import { cleanStatsPayload, run as runStats } from "./fetch-stats.mjs";
import { run as runCards } from "./fetch-cards.mjs";

const instance = {
  id: "nordhavn",
  url: "https://nordhavn.example",
  canonical: "https://nordhavn.example",
  cardsUrl: "https://nordhavn.example/.well-known/knot-cards.json",
  statsUrl: "https://nordhavn.example/api/stats",
  status: "active",
};

function jsonResponse(body, etag = null) {
  return {
    status: 200,
    headers: { get: (name) => (name.toLowerCase() === "etag" ? etag : null) },
    text: async () => JSON.stringify(body),
  };
}

test("guard: private, loopback, link-local and metadata addresses are refused", () => {
  for (const address of [
    "127.0.0.1",
    "10.1.2.3",
    "172.18.0.1",
    "192.168.3.91",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fe80::1",
    "fd00::1",
    "::ffff:127.0.0.1",
  ]) {
    assert.equal(isPublicAddress(address), false, address);
  }
  for (const address of ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"]) {
    assert.equal(isPublicAddress(address), true, address);
  }
});

test("guard: alternate IPv6 spellings cannot smuggle private or special addresses", () => {
  for (const address of [
    "::ffff:7f00:1",
    "0:0:0:0:0:ffff:7f00:1",
    "::127.0.0.1",
    "2002:7f00:1::",
    "2001:0:4136:e378:8000:63bf:3fff:fdd2",
    "2001:2::1",
    "2001:10::1",
    "2001:20::1",
    "2001:db8::1",
    "64:ff9b::7f00:1",
    "100::1",
    "fec0::1",
    "3ffe::1",
  ]) {
    assert.equal(isPublicAddress(address), false, address);
  }
  for (const address of ["2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8"]) {
    assert.equal(isPublicAddress(address), true, address);
  }
});

test("guard: only https without credentials is fetched", async (t) => {
  const resolve = async () => ["1.2.3.4"];
  await assert.rejects(() => assertPublicUrl("http://a.example", { resolve }), FetchGuardError);
  await assert.rejects(() => assertPublicUrl("https://u:p@a.example", { resolve }), FetchGuardError);
  await assert.rejects(() => assertPublicUrl("https://a.example", { resolve: async () => ["127.0.0.1"] }), (error) => error.code === "private_address");
  await assert.rejects(
    () => assertPublicUrl("https://a.example", { resolve: async () => ["::ffff:7f00:1"] }),
    (error) => error.code === "private_address"
  );
  await assert.rejects(
    () => assertPublicUrl("https://a.example", { resolve: async () => ["2002:7f00:1::"] }),
    (error) => error.code === "private_address"
  );
  const url = await assertPublicUrl("https://a.example/x", { resolve });
  assert.equal(url.toString(), "https://a.example/x");
});

test("guard: redirects, non-200 and oversized bodies are failures", async (t) => {
  const resolve = async () => ["1.2.3.4"];
  const redirect = async () => ({ status: 302, headers: { get: () => null } });
  await assert.rejects(
    () => safeGetJson("https://a.example", { resolve, fetchImpl: redirect }),
    (error) => error.code === "redirect"
  );

  const notFound = async () => ({ status: 404, headers: { get: () => null } });
  await assert.rejects(
    () => safeGetJson("https://a.example", { resolve, fetchImpl: notFound }),
    (error) => error.code === "http_404"
  );

  const huge = async () => ({
    status: 200,
    headers: { get: (name) => (name === "content-length" ? "999999" : null) },
  });
  await assert.rejects(
    () => safeGetJson("https://a.example", { resolve, fetchImpl: huge, maxBytes: 1024 }),
    (error) => error.code === "too_large"
  );

  const ok = await safeGetJson("https://a.example", { resolve, fetchImpl: async () => jsonResponse({ a: 1 }, '"v1"') });
  assert.deepEqual(ok.body, { a: 1 });
  assert.equal(ok.etag, '"v1"');
});

test("cards: valid payload is cleaned, tags stripped, images bounded", () => {
  const checked = cleanCardsPayload(
    {
      formatVersion: 1,
      generatedAt: "2026-10-18T09:00:00Z",
      cards: [
        {
          id: "c1",
          lang: "zh-CN",
          title: "<b>京都</b>的秋天",
          summary: "一条 <script>x</script> 路线。",
          body: "## 第一天\n<b>南禅寺</b>",
          url: "https://nordhavn.example/?id=1",
          images: [
            { url: "https://nordhavn.example/img/a.png", alt: "红叶", width: 1200, height: 800 },
            { url: "https://evil.example/img/b.png", width: 1, height: 1 },
            { url: "https://nordhavn.example/img/c.png", width: 0, height: 1 },
          ],
          tags: ["日本", "秋季"],
        },
      ],
    },
    { instance }
  );
  assert.equal(checked.ok, true);
  const card = checked.payload.cards[0];
  assert.equal(card.title, "京都 的秋天".replace(/\s+/g, " ").trim());
  assert.ok(!card.summary.includes("<script>"));
  assert.equal(card.images.length, 1);
  assert.equal(card.images[0].width, 1200);
  assert.equal(card.url, "https://nordhavn.example/?id=1");
});

test("cards: a foreign host or a broken payload keeps the previous copy", () => {
  const foreign = cleanCardsPayload(
    {
      formatVersion: 1,
      cards: [{ title: "outbound", url: "https://evil.example/x" }],
    },
    { instance }
  );
  assert.equal(foreign.ok, false);

  const wrongVersion = cleanCardsPayload({ formatVersion: 2, cards: [] }, { instance });
  assert.equal(wrongVersion.ok, false);

  const empty = cleanCardsPayload({ formatVersion: 1, cards: [] }, { instance });
  assert.equal(empty.ok, true);
  assert.deepEqual(empty.payload.cards, []);

  const partial = cleanCardsPayload(
    {
      formatVersion: 1,
      cards: [
        { title: "kept", url: "https://nordhavn.example/a" },
        { title: "no url" },
      ],
    },
    { instance }
  );
  assert.equal(partial.ok, true);
  assert.equal(partial.payload.cards.length, 1);
});

test("stats: only known non-negative counts survive", () => {
  const checked = cleanStatsPayload({
    generatedAt: "2026-10-19T02:00:00Z",
    posts: { total: 1234, last24h: 12, last7d: -1, secret: "x" },
    accounts: { total: 300 },
    authors: { active7d: 45 },
    email: "leak@example.com",
  });
  assert.equal(checked.ok, true);
  assert.deepEqual(checked.payload.stats, {
    posts: { total: 1234, last24h: 12 },
    accounts: { total: 300 },
    authors: { active7d: 45 },
  });
  assert.equal(checked.payload.stats.posts.secret, undefined);
  assert.equal(cleanStatsPayload({ hello: "world" }).ok, false);
});

test("run: cards are written atomically and 304 keeps the previous copy", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "xknot-cards-"));
  const instancesPath = path.join(dir, "instances.json");
  const outDir = path.join(dir, "cards");
  await writeFile(instancesPath, JSON.stringify({ instances: [instance] }));

  const resolve = async () => ["1.2.3.4"];
  const ok = await runCards({
    instancesPath,
    outDir,
    resolve,
    fetchImpl: async () => jsonResponse({ formatVersion: 1, generatedAt: "2026-10-18T09:00:00Z", cards: [{ title: "a", url: "https://nordhavn.example/a" }] }, '"v1"'),
  });
  assert.equal(ok[0].status, "ok");
  const stored = JSON.parse(await readFile(path.join(outDir, "nordhavn.json"), "utf8"));
  assert.equal(stored.cards.length, 1);
  assert.equal(stored.etag, '"v1"');

  const unchanged = await runCards({
    instancesPath,
    outDir,
    resolve,
    fetchImpl: async () => ({ status: 304, headers: { get: () => null } }),
  });
  assert.equal(unchanged[0].status, "unchanged");
  const again = JSON.parse(await readFile(path.join(outDir, "nordhavn.json"), "utf8"));
  assert.deepEqual(again.cards, stored.cards);
});

test("run: a failing partner keeps the previous stats file", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "xknot-stats-"));
  const instancesPath = path.join(dir, "instances.json");
  const outDir = path.join(dir, "stats");
  await writeFile(instancesPath, JSON.stringify({ instances: [instance] }));

  const resolve = async () => ["1.2.3.4"];
  await runStats({
    instancesPath,
    outDir,
    resolve,
    fetchImpl: async () => jsonResponse({ posts: { total: 5 } }),
  });
  const before = await readFile(path.join(outDir, "nordhavn.json"), "utf8");

  const failed = await runStats({
    instancesPath,
    outDir,
    resolve,
    fetchImpl: async () => ({ status: 500, headers: { get: () => null } }),
  });
  assert.equal(failed[0].status, "failed");
  assert.equal(await readFile(path.join(outDir, "nordhavn.json"), "utf8"), before);
});
