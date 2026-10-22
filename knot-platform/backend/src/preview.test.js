import assert from "node:assert/strict";
import test from "node:test";
import { MEDIA_PRIVATE, MEDIA_PUBLIC, directMediaReadable, mediaAudience } from "./preview.js";

const ID = "11111111-1111-4111-8111-111111111111";
const OWNER = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const WISH_USER = "44444444-4444-4444-8444-444444444444";
const AGENT = "55555555-5555-4555-8555-555555555555";

// 三条语句各答各的：媒体行、查看者的钱包、上传件的归属。
function pool(rows, { wallets = {}, uploadWallet = null } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (/FROM accounts WHERE id = \$1/.test(sql)) {
        return { rows: wallets[params[0]] ? [{ wallet: wallets[params[0]] }] : [] };
      }
      if (/FROM uploads u/.test(sql)) {
        return { rows: uploadWallet ? [{ wallet: uploadWallet }] : [] };
      }
      return { rows };
    },
  };
}

const row = (over = {}) => ({
  account_id: OWNER,
  wallet: OWNER,
  kind: "post",
  is_public: false,
  verdict: "pending",
  wish_account_id: null,
  wish_wallet: null,
  ...over,
});

test("a video poster is readable when its post is public", async () => {
  const db = pool([row({ kind: "fastpost", is_public: true })]);
  assert.equal(await directMediaReadable(db, ID, OTHER), true);
  assert.equal(db.calls[0].params[0], ID);
  assert.equal(db.calls[0].params[1], `/api/web/uploads/${ID}/display`);
});

test("a video poster stays closed when the post is private", async () => {
  const db = pool([row({ verdict: "passed" })], { wallets: { [OTHER]: OTHER } });
  assert.equal(await directMediaReadable(db, ID, OTHER), false);
});

test("the owner still reads their own poster", async () => {
  const db = pool([row()], { wallets: { [OWNER]: OWNER } });
  assert.equal(await directMediaReadable(db, ID, OWNER), true);
});

test("a rejected post no longer serves its poster", async () => {
  const db = pool([row({ kind: "fastpost", is_public: true, verdict: "rejected" })], { wallets: { [OTHER]: OTHER } });
  assert.equal(await directMediaReadable(db, ID, OTHER), false);
});

test("the poster lookup is case-insensitive", async () => {
  const db = pool([]);
  await directMediaReadable(db, ID.toUpperCase(), null);
  assert.equal(db.calls[0].params[1], `/api/web/uploads/${ID}/display`);
});

// 可见范围要分「公开」「仅当事人」两档：缓存头按它决定能不能进共享缓存。
test("an anonymous viewer reads public media and nothing else", async () => {
  const publicDb = pool([row({ is_public: true, verdict: "passed" })]);
  assert.equal(await mediaAudience(publicDb, ID, null), MEDIA_PUBLIC);
  assert.equal(publicDb.calls.length, 1, "公开图不该再为匿名访客查钱包");

  const privateDb = pool([row({ verdict: "passed" })]);
  assert.equal(await mediaAudience(privateDb, ID, null), null);
  assert.equal(privateDb.calls.length, 1);
});

test("party-only media is classified private, not public", async () => {
  const ownPost = pool([row()], { wallets: { [OWNER]: OWNER } });
  assert.equal(await mediaAudience(ownPost, ID, OWNER), MEDIA_PRIVATE);

  const replyRow = row({ kind: "wishRespond", verdict: "passed", wish_account_id: WISH_USER, wish_wallet: WISH_USER });
  const reply = pool([replyRow], { wallets: { [WISH_USER]: WISH_USER } });
  assert.equal(await mediaAudience(reply, ID, WISH_USER), MEDIA_PRIVATE);

  const stranger = pool([replyRow], { wallets: { [OTHER]: OTHER } });
  assert.equal(await mediaAudience(stranger, ID, OTHER), null);
});

test("a public row wins over the viewer being the author", async () => {
  const db = pool([row({ verdict: "passed" }), row({ is_public: true, verdict: "passed" })], { wallets: { [OWNER]: OWNER } });
  assert.equal(await mediaAudience(db, ID, OWNER), MEDIA_PUBLIC);
  assert.equal(db.calls.length, 1, "命中公开就返回，不用再查钱包");
});

// Agent 的附件归它的主人看：钱包是同一本账。
test("the owner of an agent reads the agent's private media", async () => {
  const db = pool([row({ account_id: AGENT, wallet: OWNER })], { wallets: { [OWNER]: OWNER, [AGENT]: OWNER } });
  assert.equal(await mediaAudience(db, ID, OWNER), MEDIA_PRIVATE);
  assert.equal(await mediaAudience(db, ID, AGENT), MEDIA_PRIVATE);
});

test("a person with a different wallet still reads nothing", async () => {
  const db = pool([row({ account_id: AGENT, wallet: OWNER })], { wallets: { [OTHER]: OTHER } });
  assert.equal(await mediaAudience(db, ID, OTHER), null);
});

// 发布框里的预览还没挂到记录上，上传者本人必须看得见。
test("an upload that no post references yet is readable by whoever uploaded it", async () => {
  const mine = pool([], { wallets: { [OWNER]: OWNER }, uploadWallet: OWNER });
  assert.equal(await mediaAudience(mine, ID, OWNER), MEDIA_PRIVATE);

  const agentOwned = pool([], { wallets: { [OWNER]: OWNER }, uploadWallet: OWNER });
  assert.equal(await mediaAudience(agentOwned, ID, OWNER), MEDIA_PRIVATE);

  const stranger = pool([], { wallets: { [OTHER]: OTHER }, uploadWallet: OWNER });
  assert.equal(await mediaAudience(stranger, ID, OTHER), null);

  const anonymous = pool([], { uploadWallet: OWNER });
  assert.equal(await mediaAudience(anonymous, ID, null), null);
});
