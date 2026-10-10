#!/usr/bin/env node
const BASE = (process.env.BASE || "http://127.0.0.1:8080").replace(/\/$/, "");

function jarFrom(res) {
  const raw = res.headers.getSetCookie?.() || [];
  return raw.map((item) => item.split(";")[0]).join("; ");
}

async function send(path, { method = "GET", cookie = "", token = "", body } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} ${res.status} ${data.error || ""}`);
  return { data, cookie: jarFrom(res) || cookie };
}

async function main() {
  const health = await fetch(`${BASE}/api/health`);
  if (!health.ok) throw new Error("health failed");

  const personA = await send("/api/web/session", { method: "POST", body: {} });
  const demand = await send("/api/web/expressions", {
    method: "POST",
    cookie: personA.cookie,
    body: { role: "demand", body: "安静的工位" },
  });
  if (!demand.data.expression.feedback?.includes("还没有对得上的供给")) {
    throw new Error("demand without supply should return a source suggestion");
  }
  const webFeedback = await send("/api/web/feedback", { cookie: personA.cookie });
  if (!webFeedback.data.feedback.some((item) => item.id === demand.data.expression.id)) {
    throw new Error("web feedback missing");
  }

  const personB = await send("/api/web/session", { method: "POST", body: {} });
  const supply = await send("/api/web/expressions", {
    method: "POST",
    cookie: personB.cookie,
    body: { role: "supply", body: "工位" },
  });
  if (!supply.data.expression.feedback?.startsWith("已配对")) {
    throw new Error("supply should pair with the existing demand");
  }

  const delegation = await send("/api/web/delegation", { method: "POST", cookie: personA.cookie, body: {} });
  const agent = await send("/api/agent/expressions", {
    method: "POST",
    token: delegation.data.token,
    body: { role: "supply", body: "安静的工位" },
  });
  const agentFeedback = await send("/api/agent/feedback", { token: delegation.data.token });
  if (!agentFeedback.data.feedback.some((item) => item.id === agent.data.expression.id)) {
    throw new Error("agent feedback missing");
  }
  const webAfter = await send("/api/web/feedback", { cookie: personA.cookie });
  if (webAfter.data.feedback.some((item) => item.door === "agent_api" || item.id === agent.data.expression.id)) {
    throw new Error("agent feedback leaked into webui");
  }

  console.log("phase0 smoke ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
