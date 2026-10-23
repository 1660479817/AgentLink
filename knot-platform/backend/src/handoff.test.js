import assert from "node:assert/strict";
import test from "node:test";
import { ADMIN_TTL_MS, TICKET_TTL_MS, createHandoff } from "./handoff.js";

const TOKEN = "local-e2e-admin-token-0123456789abcdef";

function clock(start = 1_700_000_000_000) {
  let at = start;
  return { now: () => at, advance: (ms) => (at += ms) };
}

test("票据换凭据：一次有效，凭据 30 天", () => {
  const time = clock();
  const handoff = createHandoff({ token: TOKEN, now: time.now });
  const { ticket, expiresAt } = handoff.issue();
  assert.match(ticket, /^t1\.\d+\.[\w-]+\.[\w-]+$/);
  assert.equal(Date.parse(expiresAt), time.now() + TICKET_TTL_MS);

  const claimed = handoff.claim(ticket);
  assert.match(claimed.credential, /^kas1\.\d+\.[\w-]+$/);
  assert.equal(claimed.expiresAt, new Date(time.now() + ADMIN_TTL_MS).toISOString());
  assert.equal(handoff.verifyAdminSession(claimed.credential), true);
});

test("票据只能用一次", () => {
  const handoff = createHandoff({ token: TOKEN });
  const { ticket } = handoff.issue();
  assert.ok(handoff.claim(ticket));
  assert.equal(handoff.claim(ticket), null);
});

test("票据过期就兑不出来", () => {
  const time = clock();
  const handoff = createHandoff({ token: TOKEN, now: time.now });
  const { ticket } = handoff.issue();
  time.advance(TICKET_TTL_MS + 1);
  assert.equal(handoff.claim(ticket), null);
});

test("改一位签名或换票据前缀都兑不出来", () => {
  const handoff = createHandoff({ token: TOKEN });
  const { ticket } = handoff.issue();
  const parts = ticket.split(".");
  // 签名末位本来可能就是 A：换成 B 才保证确实改了一位。
  const tampered = parts[3].slice(-1) === "A" ? "B" : "A";
  assert.equal(handoff.claim([...parts.slice(0, 3), `${parts[3].slice(0, -1)}${tampered}`].join(".")), null);
  assert.equal(handoff.claim([`t2`, ...parts.slice(1)].join(".")), null);
  assert.equal(handoff.claim(""), null);
  assert.equal(handoff.claim(null), null);
});

test("换主令牌：旧票据与旧凭据一起作废", () => {
  const time = clock();
  const first = createHandoff({ token: TOKEN, now: time.now });
  const { ticket } = first.issue();
  const { credential } = first.claim(ticket);
  assert.equal(first.verifyAdminSession(credential), true);

  const second = createHandoff({ token: `${TOKEN}x`, now: time.now });
  assert.equal(second.verifyAdminSession(credential), false);
  assert.equal(second.claim(ticket), null);
});

test("管理凭据 30 天后失效，且不能当票据用", () => {
  const time = clock();
  const handoff = createHandoff({ token: TOKEN, now: time.now });
  const { credential } = handoff.claim(handoff.issue().ticket);
  assert.equal(handoff.claim(credential), null);
  time.advance(ADMIN_TTL_MS + 1);
  assert.equal(handoff.verifyAdminSession(credential), false);
});

test("没有令牌时全部拒绝，不抛错", () => {
  const handoff = createHandoff({ token: "" });
  assert.equal(handoff.configured, false);
  assert.equal(handoff.issue(), null);
  assert.equal(handoff.claim("t1.1.x.y"), null);
  assert.equal(handoff.verifyAdminSession("kas1.1.x"), false);
});

test("上限之外的空间不会把已用记录挤掉：500 枚以内照样一次性", () => {
  const handoff = createHandoff({ token: TOKEN, maxPending: 500 });
  const tickets = Array.from({ length: 20 }, () => handoff.issue().ticket);
  for (const ticket of tickets) assert.ok(handoff.claim(ticket));
  for (const ticket of tickets) assert.equal(handoff.claim(ticket), null);
});

