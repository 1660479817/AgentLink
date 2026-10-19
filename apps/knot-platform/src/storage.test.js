import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DERIVED_KINDS,
  blobPath,
  derivedDir,
  ensureLayout,
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
