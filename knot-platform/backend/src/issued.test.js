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
  readRelayValues,
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
  assert.equal(values.XKNOT_ISSUED_TIER, "free");
  assert.equal(values.XKNOT_ISSUED_STATUS, "active");
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
  assert.match(await readFile(file, "utf8"), /^XKNOT_ISSUED_TIER=paid$/m);
});

test("join values: an unstated tier stays empty instead of being invented", () => {
  // 中枢没说档位时，这一侧不能替它填 free：那会由 /api/federation/profile
  // 报回中枢，中枢读到的就是自己没说过的话。
  const values = joinValues({ issued: { ...ISSUED, tier: "", status: "" }, hubOrigin: "https://xknot.si" });
  assert.equal(values.XKNOT_ISSUED_TIER, "");
  assert.equal(values.XKNOT_ISSUED_STATUS, "");
});

test("join values: a tier this build does not know is carried through unchanged", () => {
  // 词表属于中枢。这一侧认不认识这个值，都不该改写它、也不该拒绝写文件。
  const values = joinValues({
    issued: { ...ISSUED, tier: "premium", status: "frozen" },
    hubOrigin: "https://xknot.si",
  });
  assert.equal(values.XKNOT_ISSUED_TIER, "premium");
  assert.equal(values.XKNOT_ISSUED_STATUS, "frozen");
});

test("relay: the automatic path keeps a token the hub did not re-issue", async () => {
  // 自动接通只写签发区。凭据在文件里、中枢的 progress 里没有，
  // 直接照空白写就会把它抹掉，而且每轮轮询都会重写并重启 Backend。
  const dir = await mkdtemp(path.join(os.tmpdir(), "knot-issued-"));
  const file = joinEnvPath(dir);
  await writeFile(file, "XKNOT_INSTANCE_ID=cpswang\nXKNOT_HUB_RELAY_TOKEN=xkr_cpswang_0123456789abcdef\n", {
    mode: 0o600,
  });
  const relay = await readRelayValues(file);
  assert.equal(relay.relayToken, "xkr_cpswang_0123456789abcdef");

  const first = await writeJoinEnv({
    file,
    values: joinValues({ issued: ISSUED, hubOrigin: "https://xknot.si", ...relay }),
  });
  assert.equal(first.changed, true);
  assert.match(await readFile(file, "utf8"), /^XKNOT_HUB_RELAY_TOKEN=xkr_cpswang_0123456789abcdef$/m);

  // 再读一次、再写一次：键值没变，就不再重启。
  const again = await writeJoinEnv({
    file,
    values: joinValues({ issued: ISSUED, hubOrigin: "https://xknot.si", ...(await readRelayValues(file)) }),
  });
  assert.equal(again.changed, false);
});

test("write: values that would not boot the backend are refused", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "knot-issued-"));
  const file = joinEnvPath(dir);
  const values = joinValues({ issued: ISSUED, hubOrigin: "https://xknot.si" });
  values.XKNOT_INSTANCE_ID = "CPSWang"; // 大写过不了 schema
  const result = await writeJoinEnv({ file, values });
  assert.equal(result.error, "join_invalid");
  assert.match(result.detail, /XKNOT_INSTANCE_ID/);
  await assert.rejects(readFile(file, "utf8"), /ENOENT/);
});

test("restart: no unit means a command to run, not a silent success", async () => {
  const exec = async () => {
    throw new Error("Could not find service com.knot.platform");
  };
  const unit = await backendUnit({ exec });
  assert.equal(unit.installed, false);
  const result = await restartBackend({ exec });
  assert.equal(result.ok, false);
  // 实例主机只支持 macOS：没有单元时给的也是 launchctl 命令，而不是别的平台的。
  assert.match(result.command, /launchctl kickstart -k gui\/\d+\/com\.knot\.platform/);
});

test("restart: an installed unit is restarted once, and only once", async () => {
  const calls = [];
  const exec = async (cmd, args) => {
    calls.push(`${cmd} ${args.join(" ")}`);
  };
  const unit = await backendUnit({ exec });
  assert.equal(unit.installed, true);
  const result = await restartBackend({ exec });
  assert.equal(result.ok, true);
  assert.match(result.command, /launchctl kickstart -k gui\/\d+\/com\.knot\.platform/);
  // 探测一次 + 重启一次：重启本身只该发一次。
  const restarts = calls.filter((line) => line.includes("kickstart -k"));
  assert.equal(restarts.length, 1);
});
