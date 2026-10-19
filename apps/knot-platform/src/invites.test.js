import assert from "node:assert/strict";
import test from "node:test";
import {
  createInvite,
  findUsableInvite,
  inviteWindow,
  newInviteCode,
  normalizeInviteCode,
  presentInvite,
} from "./invites.js";

test("邀请码忽略大小写和分隔符", () => {
  assert.equal(normalizeInviteCode(" ab-12 cd "), "AB12CD");
  assert.equal(normalizeInviteCode("ab"), null);
  assert.equal(normalizeInviteCode("ab@cd"), "ABCD");
  assert.equal(normalizeInviteCode("a".repeat(33)), null);
  assert.equal(normalizeInviteCode(null), null);
});

test("生成的码不带 I、O、0、1", () => {
  for (let i = 0; i < 50; i += 1) assert.match(newInviteCode(), /^[A-HJ-NP-Z2-9]{8}$/);
});

test("有效期只认时、天、周", () => {
  assert.equal(inviteWindow("24h"), 24);
  assert.equal(inviteWindow("7d"), 168);
  assert.equal(inviteWindow("2w"), 336);
  assert.equal(inviteWindow(""), null);
  assert.throws(() => inviteWindow("soon"), (error) => error.code === "bad_invite_expiry");
  assert.throws(() => inviteWindow("0d"), (error) => error.code === "bad_invite_expiry");
});

test("自定义码不合法就不落库", async () => {
  const pool = {
    async query() {
      throw new Error("should not insert");
    },
  };
  await assert.rejects(() => createInvite(pool, { code: "a!" }), (error) => error.code === "bad_invite_code");
});

test("建码时写规范化的码、次数和有效期", async () => {
  let seen = null;
  const pool = {
    async query(sql, params) {
      assert.match(sql, /INSERT INTO invite_codes/);
      seen = params;
      return {
        rows: [
          {
            id: "i1",
            code: params[0],
            note: params[1],
            max_uses: params[2],
            used_count: 0,
            expires_at: params[3],
            disabled_at: null,
            created_at: new Date("2026-10-19T00:00:00Z"),
          },
        ],
      };
    },
  };
  const invite = await createInvite(pool, { code: "friends 2026", maxUses: "2", note: " 首批  " });
  assert.equal(invite.code, "FRIENDS2026");
  assert.equal(invite.maxUses, 2);
  assert.equal(invite.remaining, 2);
  assert.equal(invite.usable, true);
  assert.equal(seen[0], "FRIENDS2026");
  assert.equal(seen[1], "首批");
});

test("用完或停用的码不可用", () => {
  const base = { id: "i", code: "A", note: "", max_uses: 1, used_count: 0, expires_at: null, disabled_at: null, created_at: null };
  assert.equal(presentInvite({ ...base, used_count: 1 }).usable, false);
  assert.equal(presentInvite({ ...base, disabled_at: new Date() }).usable, false);
  assert.equal(presentInvite({ ...base, expires_at: new Date(Date.now() - 1000) }).usable, false);
  assert.equal(presentInvite(base).usable, true);
});

test("请求登录密钥时只读校验，不扣次数", async () => {
  let sql = "";
  const pool = {
    async query(text, params) {
      sql = text;
      assert.deepEqual(params, ["ABCD"]);
      return { rows: [] };
    },
  };
  assert.equal(await findUsableInvite(pool, "ab-cd"), null);
  assert.match(sql, /used_count < max_uses/);
  assert.doesNotMatch(sql, /UPDATE/);
  assert.equal(await findUsableInvite(pool, "a"), null);
});
