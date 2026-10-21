import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { hashPassword, openStore, verifyPassword } from "./store.mjs";

// 老库是 create table if not exists 建出来的，后来加的列只能靠 migrate() 补。
// 这一段照着最早的表结构建库，确认现在还能直接打开，不会被索引卡住。
const OLD_SCHEMA = `
create table applications (
  id           text primary key,
  name         text not null,
  url          text not null,
  operator     text not null,
  email        text not null,
  region       text not null,
  timezone     text not null,
  intro        text not null,
  tags         text not null default '[]',
  locale       text,
  status       text not null default 'pending',
  created_at   text not null,
  reviewed_at  text,
  reviewed_by  text,
  review_note  text,
  ip_hash      text
);
create index applications_status on applications(status, created_at);
create index applications_url on applications(url);
`;

function withTempDb(t, seed) {
  const dir = mkdtempSync(path.join(tmpdir(), "xknot-store-"));
  const file = path.join(dir, "xknot.db");
  if (seed) {
    const db = new DatabaseSync(file);
    db.exec(OLD_SCHEMA);
    seed(db);
    db.close();
  }
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return file;
}

test("old database opens: missing columns are added, case_key is filled, index exists", (t) => {
  const file = withTempDb(t, (db) => {
    db.prepare(
      `insert into applications (id, name, url, operator, email, region, timezone, intro, status, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "XK-2025-OLD001",
      "老条目",
      "https://nordhavn.xknot.si",
      "Lin",
      "lin@example.com",
      "NO",
      "Europe/Oslo",
      "旧库里的申请。",
      "approved",
      "2025-01-01T00:00:00.000Z"
    );
  });

  const store = openStore(file);
  t.after(() => store.close());

  const [row] = store.listApplications({ status: "approved" });
  assert.equal(row.id, "XK-2025-OLD001");
  assert.match(row.caseKey, /^[A-Za-z0-9_-]{8,}$/);
  assert.equal(row.stateVersion, 0);

  const db = new DatabaseSync(file, { readOnly: true });
  const indexes = db.prepare("pragma index_list(applications)").all().map((entry) => entry.name);
  const columns = db.prepare("pragma table_info(applications)").all().map((entry) => entry.name);
  db.close();
  assert.ok(indexes.includes("applications_case"));
  assert.ok(columns.includes("public_key"));
  assert.ok(columns.includes("open_until"));
});

test("password reset on an old database makes the new password valid", (t) => {
  const file = withTempDb(t, (db) => {
    db.exec(
      "create table admins (id text primary key, username text not null unique, password_hash text not null, created_at text not null, last_login_at text)"
    );
    db.prepare("insert into admins (id, username, password_hash, created_at) values (?, ?, ?, ?)").run(
      "admin-1",
      "paul",
      hashPassword("forgotten"),
      "2025-01-01T00:00:00.000Z"
    );
  });

  const store = openStore(file);
  t.after(() => store.close());

  store.setPassword("paul", "correct-horse-battery");
  assert.equal(store.verifyAdmin({ username: "paul", password: "correct-horse-battery" })?.username, "paul");
  assert.equal(store.verifyAdmin({ username: "paul", password: "forgotten" }), null);

  const row = new DatabaseSync(file, { readOnly: true })
    .prepare("select password_hash from admins where username = ?")
    .get("paul");
  assert.ok(verifyPassword("correct-horse-battery", row.password_hash));
});
