#!/usr/bin/env node
/**
 * Phase 0 E2E evaluation (API).
 * BASE=http://192.168.3.91:8080 node scripts/e2e-phase0.mjs
 * With SSH log scrape: E2E_SSH=zenwang_bot01@192.168.3.91 E2E_SSH_PASS=... node scripts/e2e-phase0.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.BASE || "http://127.0.0.1:8080").replace(/\/$/, "");
const results = [];

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  const mark = ok ? "PASS" : "FAIL";
  console.log(`${mark}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function json(method, urlPath, body, headers = {}) {
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

function scrapeCodeFromRemoteLog(email) {
  const ssh = process.env.E2E_SSH;
  if (!ssh) return null;
  const log = process.env.E2E_LOG || "~/knot/AgentLink/var/log/knot-platform.log";
  const cmd = `grep -A3 "to: '${email}'" ${log} | grep "code:" | tail -1 | sed "s/.*code: '\\([^']*\\)'.*/\\1/"`;
  const env = { ...process.env };
  let r;
  if (process.env.E2E_SSH_PASS) {
    r = spawnSync(
      "sshpass",
      ["-e", "ssh", "-o", "StrictHostKeyChecking=accept-new", ssh, cmd],
      { encoding: "utf8", env: { ...env, SSHPASS: process.env.E2E_SSH_PASS } }
    );
  } else {
    r = spawnSync("ssh", [ssh, cmd], { encoding: "utf8", env });
  }
  const code = (r.stdout || "").trim();
  return /^\d{6}$/.test(code) ? code : null;
}

async function main() {
  console.log(`E2E base: ${BASE}\n`);

  const h = await fetch(`${BASE}/api/health`);
  record("health", h.ok);

  const browse = await json("GET", "/api/cards");
  const browseOk = browse.res.ok && Array.isArray(browse.data.cards);
  record(
    "anonymous browse /api/cards",
    browseOk,
    browseOk ? `${browse.data.cards.length} cards` : browse.data.error || browse.res.status
  );

  const mineAnon = await json("GET", "/api/cards?mine=1");
  record(
    "mine without session",
    mineAnon.res.status === 403 && mineAnon.data.error === "REGISTER_REQUIRED",
    `status ${mineAnon.res.status} ${mineAnon.data.error || ""}`
  );

  const demand = await json("POST", "/api/demands", { body: "e2e automated demand ping" });
  record(
    "anonymous POST /api/demands",
    demand.res.status === 201,
    demand.res.status === 201 ? demand.data.demand?.id : String(demand.res.status)
  );

  const email = `e2e-${Date.now()}@knot.test`;
  const req = await json("POST", "/api/auth/request", { email });
  record("auth request", req.res.ok && req.data.ok, email);

  let code = process.env.E2E_CODE || scrapeCodeFromRemoteLog(email);
  if (!code) {
    record("auth verify + session", false, "no code (set E2E_CODE or E2E_SSH + E2E_SSH_PASS)");
    printSummary();
    process.exit(1);
  }

  const jar = {};
  const verifyRes = await fetch(`${BASE}/api/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code }),
  });
  const verifyData = await verifyRes.json().catch(() => ({}));
  const cookies = verifyRes.headers.getSetCookie?.() || [];
  const sid = cookies.find((c) => c.startsWith("knot_sid="));
  if (sid) jar.Cookie = sid.split(";")[0];
  record(
    "auth verify + session cookie",
    verifyRes.ok && verifyData.ok && jar.Cookie,
    verifyData.error || (jar.Cookie ? "cookie set" : "no cookie")
  );

  const me = await json("GET", "/api/auth/me", null, jar);
  record("auth/me", me.res.ok && me.data.user?.email === email, me.data.user?.email || me.data.error);

  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  const fd = new FormData();
  fd.append("file", new Blob([png], { type: "image/png" }), "e2e.png");
  const up = await fetch(`${BASE}/api/uploads`, { method: "POST", headers: jar, body: fd });
  const upData = await up.json().catch(() => ({}));
  record(
    "upload + ingest job",
    up.ok && upData.ingestJob?.status === "pending",
    upData.error || upData.ingestJob?.id
  );

  const exAnon = await json("POST", "/api/exchange/intent", { card_id: "00000000-0000-0000-0000-000000000001" });
  record(
    "exchange without session",
    exAnon.res.status === 403 && exAnon.data.error === "REGISTER_REQUIRED",
    String(exAnon.res.status)
  );

  printSummary();
  const failed = results.filter((r) => !r.ok).length;
  process.exit(failed ? 1 : 0);
}

function printSummary() {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n--- ${results.length - failed.length}/${results.length} passed ---`);
  if (failed.length) {
    console.log("Failed:", failed.map((f) => f.name).join(", "));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
