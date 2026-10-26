import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { loadEnvFile } from "./env-file.mjs";

function withFile(t, contents) {
  const dir = mkdtempSync(path.join(tmpdir(), "xknot-env-"));
  const file = path.join(dir, "mail.env");
  writeFileSync(file, contents, { mode: 0o600 });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return file;
}

test("env file: fills missing keys and leaves explicit values alone", (t) => {
  const file = withFile(
    t,
    [
      "# SMTP 配置",
      "",
      "SMTP_HOST=smtp.example.com",
      "SMTP_PORT=587",
      'MAIL_FROM="notify@example.com"',
      "XKNOT_ADMIN_EMAIL=admin@example.com # 行内不算注释，原样保留",
      "not a pair",
      "=orphan",
      "SMTP_HOST=ignored.example.com",
    ].join("\n")
  );

  const env = { SMTP_HOST: "already.set" };
  const loaded = loadEnvFile(file, env);

  // 显式给过的键不覆盖；同一文件里重复的键以第一次为准。
  assert.equal(env.SMTP_HOST, "already.set");
  assert.equal(env.SMTP_PORT, "587");
  assert.equal(env.MAIL_FROM, "notify@example.com");
  assert.ok(loaded.includes("SMTP_PORT"));
  assert.ok(!loaded.includes("SMTP_HOST"));
  // systemd 只把行首的 # 当注释；行内的 # 属于取值，不能悄悄截掉。
  assert.equal(env.XKNOT_ADMIN_EMAIL, "admin@example.com # 行内不算注释，原样保留");
});

test("env file: a missing file is not an error and loads nothing", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "xknot-env-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = {};
  assert.deepEqual(loadEnvFile(path.join(dir, "mail.env"), env), []);
  assert.deepEqual(env, {});
});
