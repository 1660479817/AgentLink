import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  GROUPS,
  KEYS,
  checkDeploy,
  checkRuntime,
  formatValue,
  parseEnv,
  renderDeployExample,
  renderDocs,
  renderRuntimeExample,
  renderRuntimeFile,
  resolve,
  updateEnvText,
} from "./schema.mjs";
import { clearPriceOverride, economyConfig } from "../../apps/knot-platform/src/points.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

function read(relative) {
  return readFileSync(`${ROOT}${relative}`, "utf8");
}

test("every key is registered once, in a known group and a known file", () => {
  const seen = new Set();
  const groups = new Set(GROUPS.map((group) => group.id));
  for (const entry of KEYS) {
    assert.ok(!seen.has(entry.key), `${entry.key} 登记了两次`);
    seen.add(entry.key);
    assert.ok(groups.has(entry.group), `${entry.key} 的分组 ${entry.group} 不存在`);
    assert.ok(["deploy", "runtime"].includes(entry.file), `${entry.key} 的 file 不对`);
    assert.ok(entry.desc && entry.desc.length > 4, `${entry.key} 缺说明`);
    assert.ok(entry.file !== "deploy" || !entry.runtime || /^[A-Z][A-Z0-9_]*$/.test(entry.runtime));
  }
});

test("generated example files and docs are committed as generated", () => {
  assert.equal(read("ops/deploy.env.example"), renderDeployExample());
  assert.equal(read("ops/env/knot-platform.env.example"), renderRuntimeExample());
  assert.equal(read("docs/CONFIG.md"), renderDocs());
});

test("a complete deploy config passes", () => {
  const result = checkDeploy({
    KNOT_SITE_NAME: "Knot",
    KNOT_PUBLIC_ORIGIN: "https://knot.example.com",
    KNOT_ADMIN_EMAIL: "admin@example.com",
    KNOT_EDGE: "0",
    KNOT_BACKUP_DIR: "$HOME/knot/backups",
  });
  assert.deepEqual(result.errors, []);
});

test("missing admin email fails", () => {
  const result = checkDeploy({});
  assert.ok(result.errors.some((message) => message.includes("KNOT_ADMIN_EMAIL")));
});

test("types are checked, not just presence", () => {
  const result = checkDeploy({
    KNOT_ADMIN_EMAIL: "not-an-email",
    KNOT_PORT: "eighty",
    KNOT_PUBLIC_ORIGIN: "knot.example.com",
    KNOT_DB_MODE: "sqlite",
    KNOT_OPENCLAW: "maybe",
    KNOT_BACKUP_DIR: "/backups",
  });
  const text = result.errors.join("\n");
  assert.match(text, /KNOT_ADMIN_EMAIL/);
  assert.match(text, /KNOT_PORT/);
  assert.match(text, /KNOT_PUBLIC_ORIGIN/);
  assert.match(text, /KNOT_DB_MODE/);
  assert.match(text, /KNOT_OPENCLAW/);
});

test("cross-key rules fire only when their condition holds", () => {
  const base = { KNOT_ADMIN_EMAIL: "admin@example.com", KNOT_BACKUP_DIR: "/backups" };
  assert.deepEqual(checkDeploy({ ...base, KNOT_EDGE: "0" }).errors, []);
  assert.ok(checkDeploy({ ...base, KNOT_EDGE: "1" }).errors.some((m) => m.includes("KNOT_EDGE_SSH")));
  assert.ok(
    checkDeploy({ ...base, KNOT_DB_MODE: "external" }).errors.some((m) => m.includes("KNOT_DATABASE_URL"))
  );
});

test("unknown deploy keys are reported as warnings, not errors", () => {
  const result = checkDeploy({
    KNOT_ADMIN_EMAIL: "admin@example.com",
    KNOT_BACKUP_DIR: "/backups",
    KNOT_SITE_NAM: "typo",
  });
  assert.deepEqual(result.errors, []);
  assert.ok(result.warnings.some((message) => message.includes("KNOT_SITE_NAM")));
});

test("a runtime file may not carry dev-only keys", () => {
  const result = checkRuntime("PORT=8080\nKNOT_EDGE_SSH_KEY=/Users/me/.ssh/id_rsa\n");
  assert.ok(result.errors.some((message) => message.includes("KNOT_EDGE_SSH_KEY")));
});

test("a runtime file warns on unknown keys and loose permissions", () => {
  const text = "PORT=8080\nKNOT_AGENT_TOKEN=secret\nSMTP_PASS=hunter2\n";
  const result = checkRuntime(text, { mode: 0o644 });
  assert.deepEqual(result.errors, []);
  assert.ok(result.warnings.some((message) => message.includes("KNOT_AGENT_TOKEN")));
  assert.ok(result.warnings.some((message) => message.includes("chmod 600")));
  assert.deepEqual(checkRuntime(text, { mode: 0o600 }).warnings.filter((m) => m.includes("chmod")), []);
});

test("runtime values are type checked too", () => {
  const result = checkRuntime("KNOT_COUPON_SIGNUP=7\nSMTP_PORT=99999\n");
  assert.match(result.errors.join("\n"), /KNOT_COUPON_SIGNUP/);
  assert.match(result.errors.join("\n"), /SMTP_PORT/);
});

test("schema defaults match the values the code falls back to", () => {
  const keys = [
    "KNOT_DEFAULT_PRICE",
    "KNOT_PRICE_MIN",
    "KNOT_PRICE_MAX",
    "KNOT_PUBLISH_SERVICE_FEE_PER_MB",
    "KNOT_DOWNLOAD_SERVICE_FEE_PER_MB",
    "KNOT_SERVICE_FEE_CAP",
    "KNOT_POINT_USD_CENTS",
    "KNOT_RETRIEVAL_PRICE",
    "KNOT_SIGNUP_GRANT",
    "KNOT_GRANT_MAX",
    "KNOT_RECHARGE_USD",
    "KNOT_MONTHLY_OPEX_USD",
    "KNOT_COUPON_TTL_DAYS",
    "KNOT_COUPON_MAX",
    "KNOT_COUPON_SIGNUP",
  ];
  const saved = new Map(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  clearPriceOverride();
  try {
    const code = economyConfig();
    const byKey = new Map(KEYS.map((entry) => [entry.key, entry]));
    assert.equal(byKey.get("KNOT_DEFAULT_PRICE").default, code.defaultPrice);
    assert.equal(byKey.get("KNOT_PRICE_MIN").default, code.priceMin);
    assert.equal(byKey.get("KNOT_PRICE_MAX").default, code.priceMax);
    assert.equal(byKey.get("KNOT_PUBLISH_SERVICE_FEE_PER_MB").default, code.publishServiceFeePerMb);
    assert.equal(byKey.get("KNOT_DOWNLOAD_SERVICE_FEE_PER_MB").default, code.downloadServiceFeePerMb);
    assert.equal(byKey.get("KNOT_SERVICE_FEE_CAP").default, code.serviceFeeCap);
    assert.equal(byKey.get("KNOT_POINT_USD_CENTS").default, code.pointUsdCents);
    assert.equal(byKey.get("KNOT_RETRIEVAL_PRICE").default, code.retrievalPrice);
    assert.equal(byKey.get("KNOT_SIGNUP_GRANT").default, code.signupGrant);
    assert.equal(byKey.get("KNOT_GRANT_MAX").default, code.grantMax);
    assert.equal(byKey.get("KNOT_RECHARGE_USD").default, code.rechargeUsd);
    assert.equal(byKey.get("KNOT_MONTHLY_OPEX_USD").default, code.monthlyOpexUsd);
    assert.equal(byKey.get("KNOT_COUPON_TTL_DAYS").default, code.couponTtlDays);
    assert.equal(byKey.get("KNOT_COUPON_MAX").default, code.couponMax);
    assert.equal(Boolean(byKey.get("KNOT_COUPON_SIGNUP").default), code.couponOnSignup);
  } finally {
    for (const [key, value] of saved) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
    clearPriceOverride();
  }
});

test("derived values follow deploy.env without being written back", () => {
  const env = {
    KNOT_PUBLIC_ORIGIN: "https://knot.example.com:8443",
    KNOT_PORT: "9090",
    KNOT_EDGE_PROXY_PORT: "18081",
    KNOT_EDGE_SSH: "ec2-user@203.0.113.10",
  };
  const byKey = new Map(KEYS.map((entry) => [entry.key, entry]));
  const ctx = { root: "/srv/knot", home: "/Users/me", expand: true };
  assert.equal(resolve(byKey.get("KNOT_DOMAIN"), env, ctx), "knot.example.com");
  assert.equal(resolve(byKey.get("KNOT_TUNNEL_SSH"), env, ctx), "knot-tunnel@203.0.113.10");
  assert.equal(resolve(byKey.get("KNOT_TUNNEL_LOCAL_PORT"), env, ctx), "9090");
  assert.equal(resolve(byKey.get("KNOT_TUNNEL_REMOTE_PORT"), env, ctx), "18081");
  assert.equal(resolve(byKey.get("KNOT_UPLOAD_DIR"), {}, ctx), "/srv/knot/var/uploads");
  assert.equal(resolve(byKey.get("KNOT_TUNNEL_KEY"), {}, ctx), "/Users/me/.ssh/knot-edge");
  // 展示远端路径时不展开本机的 home。
  assert.equal(
    resolve(byKey.get("KNOT_DEPLOY_DIR"), {}, { root: "/srv/knot", home: "/Users/me" }),
    "~/knot/AgentLink"
  );
});

test("parseEnv understands quotes, inline comments and does not expand variables", () => {
  const env = parseEnv(
    ['A=1', 'B="two words"', "C='single # not a comment'", "D=value # trailing", "E=$HOME/x", "  # F=3"].join("\n")
  );
  assert.deepEqual(env, { A: "1", B: "two words", C: "single # not a comment", D: "value", E: "$HOME/x" });
});

test("updateEnvText edits in place, uncomments, and appends missing keys", () => {
  const before = ["# 说明保留", "PORT=8080", "# SMTP_PORT=587", "CUSTOM=keep"].join("\n");
  const after = updateEnvText(before, { PORT: "9090", SMTP_PORT: "465", KNOT_SITE_NAME: "海风 站" });
  assert.match(after, /# 说明保留/);
  assert.match(after, /^PORT=9090$/m);
  assert.match(after, /^SMTP_PORT=465$/m);
  assert.match(after, /^CUSTOM=keep$/m);
  assert.match(after, /^KNOT_SITE_NAME="海风 站"$/m);
});

test("updateEnvText collapses repeated append headers", () => {
  const before = ["A=1", "# ---- 由部署脚本写入 ----", "X=1", "", "# ---- 由部署脚本写入 ----", "Y=2"].join("\n");
  const after = updateEnvText(before, { A: "2" });
  assert.equal(after.match(/由部署脚本写入/g).length, 1);
  assert.match(after, /^X=1$/m);
  assert.match(after, /^Y=2$/m);
});

test("formatValue quotes only what the shell needs", () => {
  assert.equal(formatValue("8080"), "8080");
  assert.equal(formatValue("$HOME/knot"), "$HOME/knot");
  assert.equal(formatValue("two words"), '"two words"');
  assert.equal(formatValue(""), "");
});

test("a fresh runtime file is written with resolved values and blanks commented", () => {
  const text = renderRuntimeFile({
    PORT: "8080",
    KNOT_SITE_NAME: "Knot",
    SMTP_PORT: "587",
    SMTP_PASS: "",
  });
  assert.match(text, /^PORT=8080$/m);
  assert.match(text, /^SMTP_PORT=587$/m);
  assert.match(text, /^# SMTP_PASS=$/m);
});
