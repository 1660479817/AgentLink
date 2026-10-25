// 端侧自动拉取：拿到 handoff 就写 tunnel.env，没拿到就什么都不做。
//
// 这一层不碰网络也不碰时钟：进度与落盘都由调用方注入，所以能直接断言
// 「什么时候写、写进去什么、内容没变时会不会白重启一次」。

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { joinStatePath, saveJoinState } from "./joinState.js";
import { pollIntervalMs, pollOnce, startXknotPoller } from "./xknotPoller.js";
import { tunnelEnvPath, tunnelKeyPath } from "./tunnel.js";

const APPLICATION = {
  id: "XK-2026-M5CMKG",
  caseUrl: "https://xknot.si/case/abcdefghij",
  status: "approved",
};

async function site(t, application = APPLICATION) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "knot-poller-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const profileFile = path.join(dir, "profile.json");
  if (application) await saveJoinState(joinStatePath(profileFile), application);
  return { dir, profileFile };
}

const READY = { host: "entry.example.com", account: "knot-tunnel-demo", port: 18090 };

test("poll: a missing key falls back to the default instead of switching itself off", () => {
  assert.equal(pollIntervalMs(undefined), 60_000);
  assert.equal(pollIntervalMs(""), 60_000);
  assert.equal(pollIntervalMs("120"), 120_000);
  // 写 0 才是明确关闭。
  assert.equal(pollIntervalMs("0"), 0);
  // 手滑写大了也不让它超过一小时。
  assert.equal(pollIntervalMs("99999"), 3_600_000);
});

test("poll: a site that never applied is left alone without asking the hub", async (t) => {
  const { profileFile } = await site(t, null);
  const result = await pollOnce({
    profileFile,
    localPort: 8080,
    progress: () => {
      throw new Error("should not reach the hub");
    },
  });
  assert.equal(result.skipped, "no_application");
});

test("poll: a hub that cannot be reached writes nothing", async (t) => {
  const { dir, profileFile } = await site(t);
  const result = await pollOnce({
    profileFile,
    localPort: 8080,
    progress: async () => ({ error: "unreachable" }),
  });
  assert.equal(result.error, "unreachable");
  await assert.rejects(readFile(tunnelEnvPath(dir), "utf8"), { code: "ENOENT" });
});

test("poll: waiting on the hub reports the run state and writes nothing", async (t) => {
  const { dir, profileFile } = await site(t);
  const result = await pollOnce({
    profileFile,
    localPort: 8080,
    // 端口 0 通不过校验：宁可什么都不写，也不把一条连不上的隧道写进配置。
    progress: async () => ({
      data: { run: { state: "provisioning", lastError: "dns_missing" }, handoff: { ...READY, port: 0 } },
    }),
  });
  assert.equal(result.skipped, "not_ready");
  assert.equal(result.run, "provisioning");
  assert.equal(result.lastError, "dns_missing");
  await assert.rejects(readFile(tunnelEnvPath(dir), "utf8"), { code: "ENOENT" });
});

test("poll: a handoff without its tunnel key refuses to write a config that cannot connect", async (t) => {
  const { dir, profileFile } = await site(t);
  const result = await pollOnce({
    profileFile,
    localPort: 8080,
    progress: async () => ({ data: { run: { state: "awaiting_tunnel" }, handoff: READY } }),
  });
  // 私钥是申请时那把公钥的配对件；这里现生成一把没有授权，只会换来一条永远连不上的隧道。
  assert.equal(result.error, "tunnel_key_missing");
  await assert.rejects(readFile(tunnelEnvPath(dir), "utf8"), { code: "ENOENT" });
});

test("poll: the handoff becomes tunnel.env, and a second run does not rewrite it", async (t) => {
  const { dir, profileFile } = await site(t);
  // 申请时 ensureTunnelKey 已经放过这一把；轮询只负责写配置，不碰密钥。
  await writeFile(tunnelKeyPath(dir), "-----BEGIN OPENSSH PRIVATE KEY-----\nstub\n", { mode: 0o600 });
  const progress = async () => ({ data: { run: { state: "awaiting_tunnel" }, handoff: READY } });

  const first = await pollOnce({ profileFile, localPort: 8080, progress });
  assert.equal(first.changed, true);

  const text = await readFile(tunnelEnvPath(dir), "utf8");
  // 键名与 run-entry-tunnel.sh 读的那一套一致，写错任何一个隧道都起不来。
  assert.match(text, /^KNOT_TUNNEL=1$/m);
  assert.match(text, /^KNOT_TUNNEL_SSH=knot-tunnel-demo@entry\.example\.com$/m);
  assert.match(text, /^KNOT_TUNNEL_REMOTE_PORT=18090$/m);
  assert.match(text, /^KNOT_TUNNEL_LOCAL_PORT=8080$/m);
  // 私钥只记文件名：站点目录搬家之后还要读得到旁边那把。
  assert.match(text, /^KNOT_TUNNEL_KEY=tunnel_ed25519$/m);

  // 内容没变就不该再写一次——写一次就会重启一次隧道，等于每分钟白断一次。
  const second = await pollOnce({ profileFile, localPort: 8080, progress });
  assert.equal(second.changed, false);
});

test("poller: a changed handoff restarts the tunnel once, and stop() ends the loop", async () => {
  let poller = null;
  let restarts = 0;
  await new Promise((resolve, reject) => {
    const giveUp = setTimeout(() => reject(new Error("the poller never restarted the tunnel")), 2000);
    poller = startXknotPoller({
      profileFile: "/tmp/knot-poller-does-not-need-a-real-site/profile.json",
      localPort: 8080,
      // 定时器只驱动一次判断：轮询与重启都是注入的，不碰磁盘也不碰网络。
      intervalMs: 5,
      poll: async () => ({ changed: true }),
      restart: async () => {
        restarts += 1;
        clearTimeout(giveUp);
        poller.stop();
        resolve();
        return { ok: true };
      },
      log: () => {},
    });
  });
  assert.equal(restarts, 1);
});

test("poller: a site with no application costs one interval and no restart", async () => {
  let restarts = 0;
  const poller = startXknotPoller({
    profileFile: "/tmp/knot-poller-does-not-need-a-real-site/profile.json",
    localPort: 8080,
    intervalMs: 5,
    poll: async () => ({ skipped: "no_application" }),
    restart: async () => {
      restarts += 1;
      return { ok: true };
    },
    log: () => {},
  });
  await new Promise((resolve) => setTimeout(resolve, 40));
  poller.stop();
  assert.equal(restarts, 0);
});

test("poller: 0 seconds means off, so nothing is even scheduled", async () => {
  let polls = 0;
  const poller = startXknotPoller({
    profileFile: "/tmp/knot-poller-does-not-need-a-real-site/profile.json",
    localPort: 8080,
    intervalMs: 0,
    poll: async () => {
      polls += 1;
      return { skipped: "no_application" };
    },
    log: () => {},
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  poller.stop();
  assert.equal(polls, 0);
});
