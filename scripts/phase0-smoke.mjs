#!/usr/bin/env node
/**
 * Phase 0 API smoke (no browser). Requires running platform + DB.
 * Usage: BASE=http://127.0.0.1:8080 node scripts/phase0-smoke.mjs
 */
const BASE = (process.env.BASE || "http://127.0.0.1:8080").replace(/\/$/, "");

async function main() {
  const health = await fetch(`${BASE}/api/health`);
  if (!health.ok) throw new Error("health failed");
  console.log("health ok");

  const emailA = `smoke-a-${Date.now()}@knot.test`;
  const emailB = `smoke-b-${Date.now()}@knot.test`;

  for (const email of [emailA, emailB]) {
    await json("POST", "/api/auth/request", { email });
  }

  console.log("check platform logs for auth codes (dev mail)");
  console.log("Set SMOKE_CODE_A and SMOKE_CODE_B env vars to continue automated verify");
  const codeA = process.env.SMOKE_CODE_A;
  const codeB = process.env.SMOKE_CODE_B;
  if (!codeA || !codeB) {
    console.log("partial smoke OK (request only)");
    return;
  }

  const jarA = await verifyWithCookie(emailA, codeA);
  const jarB = await verifyWithCookie(emailB, codeB);

  const tokA = await json("POST", "/api/auth/tokens", { label: "smoke" }, jarA);
  const tokB = await json("POST", "/api/auth/tokens", { label: "smoke" }, jarB);

  const agentFail = await fetch(`${BASE}/api/agent/ingest-jobs?status=pending`, {
    headers: {
      Authorization: `Bearer ${tokB.token}`,
      "X-Knot-Email": emailA,
    },
  });
  if (agentFail.status !== 401) {
    throw new Error("expected 401 for cross-user agent token");
  }
  console.log("agent cross-user block ok");

  const me = await json("GET", "/api/auth/me", null, jarA);
  if (!me.user?.email) throw new Error("session missing");
  console.log("session ok", me.user.email);

  console.log("full smoke OK (upload/agent/card requires manual image + worker)");
}

async function verifyWithCookie(email, code) {
  const res = await fetch(`${BASE}/api/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code }),
    redirect: "manual",
  });
  const setCookie = res.headers.getSetCookie?.() || [];
  const sid = setCookie.find((c) => c.startsWith("knot_sid="));
  if (!sid) throw new Error("no session cookie");
  const cookie = sid.split(";")[0];
  return { Cookie: cookie };
}

async function json(method, path, body, headers = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} ${data.error || res.status}`);
  return data;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
