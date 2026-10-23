import assert from "node:assert/strict";
import test from "node:test";
import { setSessionCookie, sessionTtlMs } from "./session.js";

const DAY = 1000 * 60 * 60 * 24;

test("session lifetime comes from config, defaulting to 30 days", () => {
  assert.equal(sessionTtlMs({}), 30 * DAY);
  assert.equal(sessionTtlMs({ KNOT_SESSION_TTL_DAYS: "7" }), 7 * DAY);
  assert.equal(sessionTtlMs({ KNOT_SESSION_TTL_DAYS: "1.5" }), 1.5 * DAY);
});

test("a broken or non-positive lifetime falls back instead of issuing a dead cookie", () => {
  for (const value of ["", "0", "-3", "thirty", "NaN"]) {
    assert.equal(sessionTtlMs({ KNOT_SESSION_TTL_DAYS: value }), 30 * DAY, `value=${value}`);
  }
});

// 入口是 https 时会话 Cookie 要带 Secure：实例按 CONFIG 绑到 0.0.0.0 供内网打开 /admin 时，
// 同一个 Cookie 也会走内网明文 http，带了 Secure 浏览器就不会在明文连接上发送它。
test("the session cookie is Secure when the public origin is https", () => {
  // 运行时环境里叫 PUBLIC_WEB_ORIGIN（KNOT_PUBLIC_ORIGIN 是站点配置里的键名）。
  const previous = process.env.PUBLIC_WEB_ORIGIN;
  const options = () => {
    const seen = [];
    const res = { cookie(name, value, opts) { seen.push({ name, value, opts }); } };
    setSessionCookie(res, "knot_sid", "sid");
    return seen[0].opts;
  };
  try {
    process.env.PUBLIC_WEB_ORIGIN = "https://wang.xknot.si";
    assert.equal(options().secure, true);
    // 本地 http 站点不带 Secure，否则登录会话在浏览器里根本存不下来。
    process.env.PUBLIC_WEB_ORIGIN = "http://127.0.0.1:8080";
    assert.equal(options().secure, false);
  } finally {
    if (previous === undefined) delete process.env.PUBLIC_WEB_ORIGIN;
    else process.env.PUBLIC_WEB_ORIGIN = previous;
  }
  // httpOnly 与 sameSite 不跟着变。
  const opts = options();
  assert.equal(opts.httpOnly, true);
  assert.equal(opts.sameSite, "lax");
});
