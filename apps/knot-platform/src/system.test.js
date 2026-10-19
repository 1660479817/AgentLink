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

test("默认把访客挡在登录页，公开快照也关着", () => {
  resetSystemPolicy();
  assert.deepEqual(siteConfig(), { guestBrowsing: false, registrationMode: "open", publicBoard: false });
  assert.equal(publicBoardEnabled(), false);
  assert.deepEqual(defaultSystemPolicy(), {
    guestBrowsing: false,
    registrationMode: "open",
    publicBoard: false,
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
  const pool = {
    async query(sql, params) {
      assert.match(sql, /INSERT INTO system_policy/);
      seen = params;
      return { rows: [{ updated_at: new Date("2026-10-19T00:00:00Z") }] };
    },
  };
  const saved = await saveSystemPolicy(pool, { guestBrowsing: true, registrationMode: "invite" });
  assert.deepEqual(seen, [true, "invite", false]);
  assert.equal(saved.guestBrowsing, true);
  assert.equal(saved.registrationMode, "invite");
  assert.equal(saved.publicBoard, false);
  assert.equal(saved.updatedAt, "2026-10-19T00:00:00.000Z");
  assert.equal(siteConfig().registrationMode, "invite");
  resetSystemPolicy();
});
