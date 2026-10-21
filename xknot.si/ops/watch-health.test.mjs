import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { watch } from "./watch-health.mjs";

const ENV = {
  SMTP_HOST: "smtp.example.test",
  SMTP_PORT: "587",
  MAIL_FROM: "no-reply@xknot.si",
  XKNOT_ADMIN_EMAIL: "ops@xknot.si",
  XKNOT_PUBLIC_ORIGIN: "https://xknot.si",
};

const INSTANCE = {
  id: "wang",
  status: "active",
  url: "https://wang.xknot.si",
  name: { en: "Wang", "zh-CN": "王" },
  contact: "wang@example.test",
  languages: ["zh-CN"],
  regions: ["EAST_ASIA"],
  timezone: "Asia/Shanghai",
  since: "2026-09-01",
};

async function fixture(instances = [INSTANCE]) {
  const dir = await mkdtemp(path.join(tmpdir(), "knot-watch-"));
  const instancesPath = path.join(dir, "instances.json");
  const healthPath = path.join(dir, "var", "health.json");
  await writeFile(instancesPath, JSON.stringify({ version: 2, instances }, null, 2));
  return { dir, instancesPath, healthPath };
}

// check-health 的结果形状；只给 watch 关心的字段。
function healthOf(state, notices = []) {
  return (_options) => ({
    checkedAt: "2026-10-20T12:00:00.000Z",
    instances: { [INSTANCE.id]: state },
    notices: notices.map((kind) => ({ id: INSTANCE.id, kind, at: "2026-10-20T12:00:00.000Z" })),
  });
}

function downState(extra = {}) {
  return {
    status: "down",
    httpStatus: 503,
    latencyMs: null,
    error: "http_503",
    downSince: "2026-10-19T11:00:00.000Z",
    ...extra,
  };
}

test("a 24 hour outage writes one partner letter", async () => {
  const paths = await fixture();
  const sent = [];
  const result = await watch({
    ...paths,
    env: ENV,
    log: () => {},
    check: healthOf(downState(), ["down_24h"]),
    deliver: async (_config, message) => sent.push(message),
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "wang@example.test");
  assert.match(sent[0].subject, /24 小时/);
  assert.match(sent[0].text, /https:\/\/wang\.xknot\.si\/api\/health/);
  assert.match(sent[0].text, /2026-10-19T11:00:00\.000Z/);
  assert.doesNotMatch(sent[0].text, /\{[a-zA-Z]+\}/, "no placeholder may reach the partner");
  assert.equal(result.sent.length, 1);
});

test("a 7 day outage notifies the partner and leaves the manifest alone", async () => {
  const paths = await fixture();
  const before = await readFile(paths.instancesPath, "utf8");
  const sent = [];

  const result = await watch({
    ...paths,
    env: ENV,
    log: () => {},
    check: healthOf(downState({ hiddenAt: "2026-10-20T12:00:00.000Z", hiddenReason: "down_7d" }), ["down_7d"]),
    deliver: async (_config, message) => sent.push(message),
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "wang@example.test");
  assert.match(sent[0].subject, /暂时关闭/);
  assert.match(sent[0].text, /探测恢复后会自动重新出现/);
  assert.equal(await readFile(paths.instancesPath, "utf8"), before, "hiding never rewrites instances.json");
  assert.equal(result.instances[INSTANCE.id].hiddenReason, "down_7d");
});

test("never connected alerts go to the operator, not the partner", async () => {
  const paths = await fixture();
  const sent = [];
  await watch({
    ...paths,
    env: ENV,
    log: () => {},
    check: healthOf(
      { status: "unknown", httpStatus: null, latencyMs: null, downSince: null, hiddenAt: null },
      ["never_14d", "never_30d"]
    ),
    deliver: async (_config, message) => sent.push(message),
  });

  assert.equal(sent.length, 2);
  for (const message of sent) {
    assert.equal(message.to, "ops@xknot.si");
    assert.match(message.text, /收录后 (14|30) 天仍未验收/);
  }
});

test("an unknown notice kind is skipped instead of mailing the wrong template", async () => {
  const paths = await fixture();
  const sent = [];
  const result = await watch({
    ...paths,
    env: ENV,
    log: () => {},
    check: healthOf(downState(), ["relay_quota_80"]),
    deliver: async (_config, message) => sent.push(message),
  });

  assert.equal(sent.length, 0);
  assert.equal(result.sent.length, 0);
});

test("--dry-run neither writes the state file nor sends mail", async () => {
  const paths = await fixture();
  const sent = [];
  const result = await watch({
    ...paths,
    env: ENV,
    dryRun: true,
    log: () => {},
    check: healthOf(downState(), ["down_24h"]),
    deliver: async (_config, message) => sent.push(message),
  });

  assert.equal(sent.length, 0);
  assert.equal(result.sent.length, 1);
  assert.equal(result.sent[0].dryRun, true);
  await assert.rejects(readFile(paths.healthPath, "utf8"), /ENOENT/);
});

test("a missing SMTP config is reported and does not throw", async () => {
  const paths = await fixture();
  const lines = [];
  let delivered = 0;
  const result = await watch({
    ...paths,
    env: {},
    log: (line) => lines.push(line),
    check: healthOf(downState(), ["down_24h"]),
    deliver: async () => {
      delivered += 1;
    },
  });

  assert.equal(delivered, 0);
  assert.equal(result.sent.length, 0);
  assert.ok(lines.some((line) => /没有 SMTP 配置/.test(line)));
});

test("a suspended entry is never probed or mailed", async () => {
  const suspended = { ...INSTANCE, id: "old", status: "suspended", contact: "old@example.test" };
  const paths = await fixture([suspended]);
  const sent = [];
  await watch({
    ...paths,
    env: ENV,
    log: () => {},
    check: healthOf({ status: "unknown", hiddenAt: null, downSince: null }, []),
    deliver: async (_config, message) => sent.push(message),
  });

  assert.equal(sent.length, 0);
});
