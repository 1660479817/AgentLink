import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DERIVED_KINDS,
  USED_UPLOADS_SQL,
  blobPath,
  derivedDir,
  ensureLayout,
  keepDerivedFile,
  legacyBlobPath,
  readableBlobPath,
  shardOf,
  tmpDir,
} from "./storage.js";

test("blobs are sharded by the first two characters", () => {
  assert.equal(shardOf("aabbccdd-1111-4111-8111-111111111111.png"), "aa");
  assert.equal(shardOf("0F.png"), "0f");
  assert.equal(shardOf(""), "_");
  assert.equal(shardOf("../etc/passwd"), "_");
});

test("a storage name cannot escape the upload directory", () => {
  const root = "/srv/knot/uploads";
  assert.equal(blobPath(root, "../../etc/passwd"), path.join(root, "blobs", "pa", "passwd"));
  assert.equal(derivedDir(root, "shares"), path.join(root, "derived", "shares"));
});

test("the layout creates blobs, tmp and every derived folder", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "knot-layout-"));
  try {
    ensureLayout(root);
    assert.ok(fs.statSync(path.join(root, "blobs")).isDirectory());
    assert.ok(fs.statSync(tmpDir(root)).isDirectory());
    for (const kind of DERIVED_KINDS) {
      assert.ok(fs.statSync(derivedDir(root, kind)).isDirectory(), kind);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reads fall back to the old root layout while the migration has not run", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "knot-legacy-"));
  try {
    const name = "aabbccdd-1111-4111-8111-111111111111.png";
    await writeFile(legacyBlobPath(root, name), "old");
    assert.equal(readableBlobPath(root, name), legacyBlobPath(root, name));

    fs.mkdirSync(path.dirname(blobPath(root, name)), { recursive: true });
    await writeFile(blobPath(root, name), "new");
    assert.equal(readableBlobPath(root, name), blobPath(root, name));

    assert.equal(readableBlobPath(root, "missing.png"), blobPath(root, "missing.png"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// 引用集合只写一份给审计脚本和 GC 用。少一类就会把仍在用的原件报成孤儿，
// 照清单清理就是删掉正文里还嵌着的图（S11-09、S11-11）。
test("the shared reference SQL covers every way an upload can be used", () => {
  for (const fragment of [
    "FROM intel_files",
    "avatar_upload_id FROM accounts",
    "image_upload_id FROM sponsors",
    "v->>'poster'",
    "regexp_matches(",
  ]) {
    assert.ok(USED_UPLOADS_SQL.includes(fragment), fragment);
  }
  // 正文里嵌的地址用 match 而不是 regexp_match：一行可能有多个，要展开成多行。
  assert.match(USED_UPLOADS_SQL, /regexp_matches\(\s*i\.body,[\s\S]*'g'\s*\)/);
});

test("a derived file is kept only while its subject exists", () => {
  // display 的文件名是 <storage_name>.jpg，原件名本身带扩展名。
  const names = new Set(["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png"]);
  const ids = new Set(["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"]);
  assert.equal(keepDerivedFile("display", "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA.PNG.jpg", names, ids), true);
  assert.equal(keepDerivedFile("display", "cccccccc-cccc-4ccc-8ccc-cccccccccccc.jpg", names, ids), false);
  assert.equal(keepDerivedFile("packets", "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB.zip", names, ids), true);
  assert.equal(keepDerivedFile("extracts", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.md", names, ids), true);
  assert.equal(keepDerivedFile("shares", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", names, ids), true);
  assert.equal(keepDerivedFile("shares", "dddddddd-dddd-4ddd-8ddd-dddddddddddd", names, ids), false);
  // 认不出的种类不动：宁可漏删，不要删错。
  assert.equal(keepDerivedFile("unknown", "anything", names, ids), true);
});
