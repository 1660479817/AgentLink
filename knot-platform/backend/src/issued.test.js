// 接入件（xknot.env）的写入与重启。
//
// 键值由中枢的 progress 给出，格式交给 @knot/config；这里只负责校验、比较与落盘。
// 写错接入件的代价是整站起不来，所以 id 与地址必须互相印证。

import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  backendUnit,
  issuedValid,
  joinEnvPath,
  joinValues,
  restartBackend,
  writeJoinEnv,
} from "./issued.js";

const ISSUED = {
  id: "cpswang",
  url: "https://cpswang.xknot.si",
  since: "2026-10-21",
  tier: "free",
  status: "active",
};

test("issued: the address must be https and its label must match the id", () => {
  assert.equal(issuedValid(ISSUED), true);
  assert.equal(issuedValid({ ...ISSUED, url: "http://cpswang.xknot.si" }), false);
  assert.equal(issuedValid({ ...ISSUED, url: "https://other.xknot.si" }), false);
  assert.equal(issuedValid({ ...ISSUED, url: "https://cpswang.example.com" }), false);
  assert.equal(issuedValid({ ...ISSUED, id: "CPswang" }), false);
  assert.equal(issuedValid(null), false);
});

test("join values: keys come from the hub, host is the case origin", () => {
  const values = joinValues({ issued: ISSUED, hubOrigin: "https://xknot.si/" });
  assert.equal(values.XKNOT_INSTANCE_ID, "cpswang");
  assert.equal(values.XKNOT_ISSUED_URL, "https://cpswang.xknot.si");
  assert.equal(values.XKNOT_ISSUED_AT, "2026-10-21");
  assert.equal(values.XKNOT_TIER, "free");
  assert.equal(values.XKNOT_HUB_ORIGIN, "https://xknot.si");
  assert.equal(values.XKNOT_HUB_RELAY_TOKEN, "");
});

test("write: new file is 600 and only rewritten when keys change", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "knot-issued-"));
  assert.equal(joinEnvPath(dir), path.join(dir, "xknot.env"));
  const file = joinEnvPath(dir);
  const values = joinValues({ issued: ISSUED, hubOrigin: "https://xknot.si" });

  const first = await writeJoinEnv({ file, values });
  assert.equal(first.changed, true);
  const text = await readFile(file, "utf8");
  assert.match(text, /^XKNOT_INSTANCE_ID=cpswang$/m);
  assert.match(text, /^XKNOT_ISSUED_URL=https:\/\/cpswang\.xknot\.si$/m);
  assert.equal((await stat(file)).mode & 0o777, 0o600);

  const second = await writeJoinEnv({ file, values });
  assert.equal(second.changed, false);
});

test("write: hand-written comments survive when the keys are unchanged", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "knot-issued-"));
  const file = joinEnvPath(dir);
  const values = joinValues({ issued: ISSUED, hubOrigin: "https://xknot.si" });
  await writeJoinEnv({ file, values });

  const edited = `# 我自己加的一行\n${(await readFile(file, "utf8"))}`;
  await writeFile(file, edited);

  const again = await writeJoinEnv({ file, values });
  assert.equal(again.changed, false);
  assert.match(await readFile(file, "utf8"), /^# 我自己加的一行/);
});

test("write: a changed tier rewrites the file", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "knot-issued-"));
  const file = joinEnvPath(dir);
  await writeJoinEnv({ file, values: joinValues({ issued: ISSUED, hubOrigin: "https://xknot.si" }) });
  const paid = await writeJoinEnv({
    file,
    values: joinValues({ issued: { ...ISSUED, tier: "paid" }, hubOrigin: "https://xknot.si" }),
  });
  assert.equal(paid.changed, true);
  assert.match(await readFile(file, "utf8"), /^XKNOT_TIER=paid$/m);
});

test("restart: no unit means a command to run, not a silent success", async () => {
  const exec = async () => {
    throw new Error("Unit knot-backend.service not found.");
  };
  const unit = await backendUnit({ platform: "linux", exec });
  assert.equal(unit.installed, false);
  const result = await restartBackend({ platform: "linux", exec });
  assert.equal(result.ok, false);
  assert.match(result.command, /systemctl restart knot-backend/);
});

test("restart: an installed unit is restarted once, and only once", async () => {
  const calls = [];
  const exec = async (cmd, args) => {
    calls.push(`${cmd} ${args.join(" ")}`);
  };
  const unit = await backendUnit({ platform: "linux", exec });
  assert.equal(unit.installed, true);
  const result = await restartBackend({ platform: "linux", exec });
  assert.equal(result.ok, true);
  // 探测可能问两次（先看单元在不在，重启前再确认），但重启本身只发一次。
  assert.equal(calls.filter((line) => line === "sudo systemctl restart knot-backend").length, 1);
});
