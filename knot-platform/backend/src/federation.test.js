import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import { federationStatus, maskSecret, readJoinFile, xknotEnvPath } from "./federation.js";
import { adminRouter } from "./routes/admin.js";

const TOKEN = "xkr_wang_0123456789abcdef";

function fakeFile(text, mode = 0o600) {
  return { path: "/srv/knot/sites/bot01/xknot.env", exists: true, text, mode, error: null };
}

const JOINED = [
  "XKNOT_INSTANCE_ID=wang",
  "XKNOT_HUB_ORIGIN=https://xknot.si",
  `XKNOT_HUB_RELAY_TOKEN=${TOKEN}`,
  "XKNOT_ISSUED_AT=2026-10-20",
].join("\n");

function envOf(overrides = {}) {
  return {
    XKNOT_INSTANCE_ID: "wang",
    XKNOT_HUB_ORIGIN: "https://xknot.si",
    XKNOT_HUB_RELAY_TOKEN: TOKEN,
    XKNOT_ISSUED_AT: "2026-10-20",
    ...overrides,
  };
}

test("the join file sits next to the agent directory", () => {
  assert.equal(xknotEnvPath({}, "/srv/knot/sites/bot01/agents"), "/srv/knot/sites/bot01/xknot.env");
  assert.equal(xknotEnvPath({ KNOT_XKNOT_ENV: "/etc/knot/join.env" }, "/srv/knot/sites/bot01/agents"), "/etc/knot/join.env");
  assert.equal(xknotEnvPath({}, null), null);
});

test("secrets are shown short, never whole", () => {
  assert.equal(maskSecret(""), "");
  assert.equal(maskSecret("short"), "****");
  assert.equal(maskSecret(TOKEN), "xkr_wang…cdef");
});

test("an unjoined instance still deploys, and the view says so", () => {
  const status = federationStatus({ env: {}, joinFile: { path: null, exists: false, text: "", mode: null, error: null } });
  assert.equal(status.joined, false);
  assert.equal(status.file.exists, false);
  assert.equal(status.stored, null);
  assert.deepEqual(status.drift, []);
  assert.deepEqual(
    status.signals.map((signal) => signal.code).sort(),
    ["mail_unavailable", "not_joined"]
  );
  assert.equal(status.signals.find((signal) => signal.code === "not_joined").level, "info");
});

test("a complete join file reports the instance and derives the relay url", () => {
  const status = federationStatus({
    env: envOf(),
    joinFile: fakeFile(JOINED),
    publicWebOrigin: "https://wang.xknot.si",
    now: () => new Date("2026-10-20T12:00:00.000Z"),
  });
  assert.equal(status.joined, true);
  assert.equal(status.checkedAt, "2026-10-20T12:00:00.000Z");
  assert.equal(status.file.permissions, "0600");
  assert.equal(status.running.instanceId, "wang");
  assert.equal(status.running.relayUrl, "https://xknot.si/api/federation/mail");
  assert.equal(status.running.relayUrlSource, "derived");
  assert.equal(status.running.relayToken.masked, "xkr_wang…cdef");
  assert.deepEqual(status.drift, []);
  assert.equal(status.health.url, "https://wang.xknot.si/api/health");
  assert.equal(status.health.reportsInstance, true);
  assert.equal(status.health.https, true);
  assert.equal(status.mail.mode, "relay");
  assert.deepEqual(status.signals, [
    {
      level: "info",
      code: "feedback_needs_smtp",
      text: "建议与投诉信只走本机 SMTP：现在只配了委托发信，用户提交反馈会拿到 mail_unavailable。",
    },
    { level: "ok", code: "joined", text: "接入件齐全，/api/health 会报出 instance。" },
  ]);
  assert.equal(JSON.stringify(status).includes(TOKEN), false);
});

test("a join file that changed after the last start shows up as drift", () => {
  const status = federationStatus({
    env: envOf({ XKNOT_INSTANCE_ID: "old", XKNOT_HUB_RELAY_TOKEN: "xkr_old_0123456789abcdef" }),
    joinFile: fakeFile(JOINED),
    publicWebOrigin: "https://wang.xknot.si",
  });
  assert.deepEqual(
    status.drift.map((entry) => entry.key),
    ["XKNOT_INSTANCE_ID", "XKNOT_HUB_RELAY_TOKEN"]
  );
  const token = status.drift.find((entry) => entry.key === "XKNOT_HUB_RELAY_TOKEN");
  assert.equal(token.running, "xkr_old_…cdef");
  assert.equal(token.stored, "xkr_wang…cdef");
  const codes = status.signals.map((signal) => signal.code);
  assert.ok(codes.includes("restart_required"));
  assert.equal(JSON.stringify(status).includes("xkr_old_0123456789abcdef"), false);
});

test("a loose join file warns about permissions and a missing instance id", () => {
  const status = federationStatus({
    env: { XKNOT_HUB_ORIGIN: "https://xknot.si" },
    joinFile: fakeFile("XKNOT_HUB_ORIGIN=https://xknot.si", 0o644),
  });
  const codes = status.signals.map((signal) => signal.code);
  assert.equal(status.file.permissions, "0644");
  assert.ok(codes.includes("join_file"));
  assert.equal(status.signals.some((signal) => signal.level === "error"), true);
  assert.match(status.signals.map((signal) => signal.text).join("\n"), /缺少 XKNOT_INSTANCE_ID/);
  assert.match(status.signals.map((signal) => signal.text).join("\n"), /chmod 600/);
});

test("a relay token without a hub origin falls back to local smtp", () => {
  const withSmtp = federationStatus({
    env: { XKNOT_HUB_RELAY_TOKEN: TOKEN, SMTP_HOST: "smtp.example.com", MAIL_FROM: "knot@example.com" },
  });
  assert.equal(withSmtp.mail.mode, "smtp");
  assert.deepEqual(
    withSmtp.signals.map((signal) => signal.code),
    ["running_without_file", "relay_without_origin"]
  );

  const withoutSmtp = federationStatus({ env: { XKNOT_HUB_RELAY_TOKEN: TOKEN } });
  assert.equal(withoutSmtp.mail.mode, "none");
  assert.deepEqual(
    withoutSmtp.signals.map((signal) => signal.code),
    ["running_without_file", "relay_without_origin", "mail_unavailable"]
  );
});

test("smtp needs a sender address, not just a host", () => {
  const status = federationStatus({ env: { SMTP_HOST: "smtp.example.com" } });
  // 只配主机时会用一个没人认得的地址发信，收件方按伪造处理，所以算未配置。
  assert.equal(status.mail.mode, "none");
  assert.equal(status.mail.smtpConfigured, false);
  assert.equal(status.mail.smtpHostWithoutFrom, true);
  const signal = status.signals.find((entry) => entry.code === "mail_unavailable");
  assert.match(signal.text, /MAIL_FROM/);

  const fromEnv = federationStatus({ env: { SMTP_HOST: "smtp.example.com", SMTP_FROM: "knot@example.com" } });
  assert.equal(fromEnv.mail.mode, "smtp");
  assert.equal(fromEnv.mail.smtpHostWithoutFrom, false);
});

test("both channels configured means relay with an smtp fallback", () => {
  const status = federationStatus({
    env: envOf({ SMTP_HOST: "smtp.example.com", MAIL_FROM: "knot@example.com" }),
    joinFile: fakeFile(JOINED),
  });
  assert.equal(status.mail.mode, "relay");
  assert.equal(status.mail.smtpConfigured, true);
  assert.equal(status.mail.relayFallback, true);
  assert.equal(status.signals.some((entry) => entry.code === "feedback_needs_smtp"), false);

  const relayOnly = federationStatus({ env: envOf(), joinFile: fakeFile(JOINED) });
  assert.equal(relayOnly.mail.relayFallback, false);
  // 只配委托时反馈信发不出去，面板要说出来。
  assert.equal(relayOnly.signals.some((entry) => entry.code === "feedback_needs_smtp"), true);
});

test("the hub can only probe an https address, and never a loopback one", () => {
  const plain = federationStatus({
    env: envOf(),
    joinFile: fakeFile(JOINED),
    publicWebOrigin: "http://wang.example.com",
  });
  assert.equal(plain.health.https, false);
  assert.ok(plain.signals.some((signal) => signal.code === "health_not_https"));

  const loopback = federationStatus({
    env: envOf(),
    joinFile: fakeFile(JOINED),
    publicWebOrigin: "http://127.0.0.1:8080",
  });
  assert.equal(loopback.health.privateAddress, true);
  assert.ok(loopback.signals.some((signal) => signal.code === "health_private"));
});

test("a public instance without an instance id says what the hub will do", () => {
  const status = federationStatus({
    env: { SMTP_HOST: "smtp.example.com" },
    joinFile: { path: null, exists: false, text: "", mode: null, error: null },
    publicWebOrigin: "https://knot.example.com",
  });
  assert.equal(status.health.reportsInstance, false);
  assert.ok(status.signals.some((signal) => signal.code === "no_instance"));
});

test("the join file reader treats a missing file as unjoined, not as an error", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "knot-join-"));
  try {
    const missing = readJoinFile(path.join(dir, "xknot.env"));
    assert.equal(missing.exists, false);
    assert.equal(missing.error, null);

    const file = path.join(dir, "xknot.env");
    writeFileSync(file, JOINED);
    chmodSync(file, 0o600);
    const found = readJoinFile(file);
    assert.equal(found.exists, true);
    assert.equal(found.mode, 0o600);
    assert.match(found.text, /XKNOT_INSTANCE_ID=wang/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the federation view is behind the admin token", async () => {
  const app = express();
  app.use("/api/admin", adminRouter({ pool: null, token: "secret", uploadDir: null }));
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/admin/federation`;
    assert.equal((await fetch(base)).status, 401);
    const response = await fetch(base, { headers: { authorization: "Bearer secret" } });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(typeof data.joined, "boolean");
    assert.ok(Array.isArray(data.signals));
    assert.equal(data.file.path === undefined, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
