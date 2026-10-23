import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultSystemPolicy,
  installSystemPolicy,
  parseSystemPatch,
  publicBoardEnabled,
  resetSystemPolicy,
  saveSystemPolicy,
  siteConfig,
  systemPolicyView,
} from "./system.js";

test("默认开着站内浏览和公开快照", () => {
  resetSystemPolicy();
  assert.deepEqual(siteConfig(), { guestBrowsing: true, registrationMode: "open", publicBoard: true });
  assert.equal(publicBoardEnabled(), true);
  assert.deepEqual(defaultSystemPolicy(), {
    guestBrowsing: true,
    registrationMode: "open",
    publicBoard: true,
    updatedAt: null,
  });
});

test("快照要同时开着站内浏览才有内容", () => {
  installSystemPolicy({ guestBrowsing: false, registrationMode: "open", publicBoard: true });
  assert.equal(publicBoardEnabled(), false);
  assert.equal(siteConfig().publicBoard, false);
  assert.equal(systemPolicyView().publicBoard, false);
  installSystemPolicy({ guestBrowsing: true, registrationMode: "open", publicBoard: true });
  assert.equal(publicBoardEnabled(), true);
});

test("关掉站内浏览时，公开快照一起关", () => {
  installSystemPolicy({ guestBrowsing: true, registrationMode: "open", publicBoard: true });
  assert.deepEqual(parseSystemPatch({ guestBrowsing: 0 }), { guestBrowsing: false, publicBoard: false });
});

test("开关认 0/1 和常见字样，不认别的", () => {
  installSystemPolicy({ guestBrowsing: true, registrationMode: "open", publicBoard: false });
  assert.deepEqual(parseSystemPatch({ guestBrowsing: "1", publicBoard: "1" }), {
    guestBrowsing: true,
    publicBoard: true,
  });
  assert.deepEqual(parseSystemPatch({ guestBrowsing: 0 }), { guestBrowsing: false, publicBoard: false });
  assert.deepEqual(parseSystemPatch({ guestBrowsing: 1 }), { guestBrowsing: true });
  assert.throws(() => parseSystemPatch({ guestBrowsing: "maybe" }), (error) => error.code === "bad_switch");
  assert.throws(() => parseSystemPatch({ registrationMode: "friends" }), (error) => error.code === "bad_registration_mode");
  assert.throws(() => parseSystemPatch({}), (error) => error.code === "bad_args");
});

test("保存后进程里的策略立刻换掉", async () => {
  resetSystemPolicy();
  let seen = null;
  let statement = "";
  const pool = {
    async query(sql, params) {
      assert.match(sql, /INSERT INTO system_policy/);
      statement = sql;
      seen = params;
      // 关掉站内浏览时 publicBoard 跟着关，所以这里 RETURNING 三个列都要有。
      return {
        rows: [{
          guest_browsing: true,
          registration_mode: "invite",
          public_board: true,
          updated_at: new Date("2026-10-19T00:00:00Z"),
        }],
      };
    },
  };
  const saved = await saveSystemPolicy(pool, { guestBrowsing: true, registrationMode: "invite" });
  assert.deepEqual(seen, [true, "invite", true]);
  assert.equal(saved.guestBrowsing, true);
  assert.equal(saved.registrationMode, "invite");
  assert.equal(saved.publicBoard, true);
  assert.equal(saved.updatedAt, "2026-10-19T00:00:00.000Z");
  assert.equal(siteConfig().registrationMode, "invite");
  // 只覆盖这次改的列：没提到的 public_board 保留库里的值，并发 PATCH 才不会互相抹掉。
  assert.match(statement, /registration_mode = EXCLUDED\.registration_mode/);
  assert.match(statement, /guest_browsing = EXCLUDED\.guest_browsing/);
  assert.doesNotMatch(statement, /public_board = EXCLUDED\.public_board/);
  resetSystemPolicy();
});
