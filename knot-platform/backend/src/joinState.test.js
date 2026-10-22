import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { joinStatePath, readJoinState, saveJoinState } from "./joinState.js";

function tempSite() {
  const dir = mkdtempSync(path.join(tmpdir(), "knot-join-"));
  return { dir, file: path.join(dir, "join.json"), profileFile: path.join(dir, "profile.json") };
}

test("join state: sits next to profile.json and survives a round trip", async () => {
  const { dir, file, profileFile } = tempSite();
  try {
    assert.equal(joinStatePath(profileFile), file);
    assert.equal(joinStatePath(null), null);

    const saved = await saveJoinState(file, {
      id: "XK-2026-ABC123",
      caseUrl: "https://xknot.si/case/abc_DEF-123",
      status: "pending",
      createdAt: "2026-10-21T11:34:05.947Z",
    });
    assert.equal(saved.application.id, "XK-2026-ABC123");

    const state = await readJoinState(file);
    assert.equal(state.application.id, "XK-2026-ABC123");
    assert.equal(state.application.status, "pending");
    assert.equal(state.application.caseUrl, "https://xknot.si/case/abc_DEF-123");
    assert.equal(state.application.submittedAt, "2026-10-21T11:34:05.947Z");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("join state: the case link is a capability, so the file is 600", async () => {
  const { dir, file } = tempSite();
  try {
    await saveJoinState(file, { id: "XK-1", caseUrl: "https://hub.example/case/k" });
    const mode = statSync(file).mode & 0o777;
    assert.equal(mode, 0o600);
    assert.equal(readFileSync(file, "utf8").includes("XK-1"), true);
    assert.equal(joinStatePath(""), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("join state: a half-written or unsafe record reads as absent", async () => {
  const { dir, file } = tempSite();
  try {
    writeFileSync(file, "{not json");
    assert.equal(await readJoinState(file), null);

    writeFileSync(file, JSON.stringify({ application: { id: "XK-1" } }));
    assert.equal(await readJoinState(file), null, "没有案例链接就不算记录");

    writeFileSync(
      file,
      JSON.stringify({ application: { id: "XK-1", caseUrl: "javascript:alert(1)" } })
    );
    assert.equal(await readJoinState(file), null, "只收 http(s) 链接");

    // 不传文件路径时不报错，直接当作没有记录。
    assert.equal(await readJoinState(null), null);
    assert.equal(await saveJoinState(null, { id: "XK-1", caseUrl: "https://h/c" }), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
