import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { latestArtifact, platformTag, readBuildFile, releaseName, sha256File, verifyArtifact } from "./artifact.mjs";

function tempDir() {
  return mkdtempSync(path.join(tmpdir(), "knot-artifact-"));
}

const INFO = {
  version: "0.2.0",
  commit: "abc1234",
  platform: "darwin-arm64",
  builtAt: "2026-10-20T03:00:00.000Z",
  dirty: false,
};

test("release name follows version, commit and dirty flag", () => {
  assert.equal(releaseName(INFO), "knot-0.2.0-abc1234");
  assert.equal(releaseName({ ...INFO, dirty: true }), "knot-0.2.0-abc1234-dirty");
});

test("platform tag is read from the running node", () => {
  assert.equal(platformTag("linux", "x64"), "linux-x64");
  assert.match(platformTag(), /^(darwin|linux|win32)-/);
});

test("a build file is read from a release directory", () => {
  const dir = tempDir();
  writeFileSync(path.join(dir, "BUILD.json"), JSON.stringify(INFO));
  assert.equal(readBuildFile(dir).commit, "abc1234");
});

test("a source checkout is rejected with a clear message", () => {
  const dir = tempDir();
  assert.throws(() => readBuildFile(dir), /不是发布包/);
});

test("a build file missing a field is rejected", () => {
  const dir = tempDir();
  writeFileSync(path.join(dir, "BUILD.json"), JSON.stringify({ version: "0.2.0" }));
  assert.throws(() => readBuildFile(dir), /缺少 commit/);
});

test("checksums are verified, and a tampered artifact fails", async () => {
  const dir = tempDir();
  const tarball = path.join(dir, "knot-0.2.0-abc1234.tar.gz");
  writeFileSync(tarball, "artifact");
  const sum = await sha256File(tarball);
  writeFileSync(`${tarball}.sha256`, `${sum}  ${path.basename(tarball)}\n`);
  assert.equal(await verifyArtifact(tarball), sum);

  writeFileSync(tarball, "tampered");
  await assert.rejects(() => verifyArtifact(tarball), /校验和不一致/);
});

test("the newest artifact wins over the alphabetically last one", async () => {
  const dir = tempDir();
  const older = path.join(dir, "a-old.tar.gz");
  const newer = path.join(dir, "z-new.tar.gz");
  writeFileSync(older, "old");
  writeFileSync(newer, "new");
  assert.equal(latestArtifact(dir), newer);
});
