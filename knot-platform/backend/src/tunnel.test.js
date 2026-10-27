// 自动接通的端侧动作：密钥、案例页接口、托管段、重启命令。
//
// 全部用假 exec / 假 fetch 跑：不生成真密钥、不访问网络，也不会动到 site.env。

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  MANAGED_END,
  MANAGED_START,
  applyManagedBlock,
  caseEndpoint,
  deployRootOf,
  ensureTunnelKey,
  fetchProgress,
  handoffValid,
  renderManagedBlock,
  renderAgentPlist,
  restartTunnel,
  scheduleTunnelRestart,
  startTunnelAgent,
  submitPublicKey,
  tunnelEnvPath,
  tunnelKeyPath,
  tunnelUnitInstalled,
} from "./tunnel.js";

const CASE_URL = "https://xknot.si/case/DrBwXKN_EPZm";

test("case url: the case key maps to the capability endpoints and nothing else", () => {
  assert.equal(caseEndpoint(CASE_URL, "progress"), "https://xknot.si/api/case/DrBwXKN_EPZm/progress");
  assert.equal(caseEndpoint(`${CASE_URL}/`, "public-key"), "https://xknot.si/api/case/DrBwXKN_EPZm/public-key");
  // 不是案例链接就直接拒绝：不能把别的地址当成上传口。
  assert.equal(caseEndpoint("https://xknot.si/admin/abc", "progress"), null);
  assert.equal(caseEndpoint("javascript:alert(1)", "progress"), null);
  assert.equal(caseEndpoint("", "progress"), null);
});

test("key: an existing public key is reused, not rotated", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "knot-key-"));
  const file = tunnelKeyPath(dir);
  await writeFile(`${file}.pub`, "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExisting site\n");
  let called = 0;

  const key = await ensureTunnelKey({ file, exec: async () => { called += 1; } });
  assert.equal(key.created, false);
  assert.match(key.publicKey, /^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExisting/);
  assert.equal(called, 0, "ssh-keygen must not run when .pub exists");
});

test("key: a missing key is generated with no passphrase", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "knot-key-"));
  const file = tunnelKeyPath(dir);
  let args = null;

  const key = await ensureTunnelKey({
    file,
    comment: "knot-tunnel-local",
    exec: async (cmd, argv) => {
      args = [cmd, ...argv];
      await writeFile(`${file}.pub`, "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINew knot-tunnel-local\n");
      await writeFile(file, "PRIVATE");
    },
  });

  assert.equal(key.created, true);
  assert.deepEqual(args.slice(0, 2), ["ssh-keygen", "-t"]);
  assert.ok(args.includes("ed25519"));
  assert.ok(args.includes(""), "empty passphrase");
  assert.ok(args.includes("-C"));
  assert.ok(args.includes("knot-tunnel-local"));
});

test("key: keygen failure is reported, not swallowed", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "knot-key-"));
  const key = await ensureTunnelKey({
    file: tunnelKeyPath(dir),
    exec: async () => {
      throw new Error("permission denied");
    },
  });
  assert.equal(key.error, "keygen_failed");
});

test("submit: posts the public key as a form and accepts the case page redirect", async () => {
  let request = null;
  const result = await submitPublicKey({
    caseUrl: CASE_URL,
    publicKey: "ssh-ed25519 AAAA test\n",
    fetchImpl: async (url, init) => {
      request = { url, init };
      return { status: 303 };
    },
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(request.url, "https://xknot.si/api/case/DrBwXKN_EPZm/public-key");
  assert.equal(request.init.method, "POST");
  assert.match(request.init.headers["content-type"], /x-www-form-urlencoded/);
  assert.equal(new URLSearchParams(request.init.body).get("publicKey"), "ssh-ed25519 AAAA test");
});

test("submit: a rejected key does not look like success", async () => {
  const result = await submitPublicKey({
    caseUrl: CASE_URL,
    publicKey: "not-a-key",
    fetchImpl: async () => ({ status: 400 }),
  });
  assert.equal(result.error, "rejected");
  assert.equal(result.status, 400);
});

test("progress: read by case key, and a hub error is surfaced", async () => {
  const ok = await fetchProgress({
    caseUrl: CASE_URL,
    fetchImpl: async () => ({ status: 200, json: async () => ({ run: { state: "awaiting_tunnel" } }) }),
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.data.run.state, "awaiting_tunnel");

  const failed = await fetchProgress({ caseUrl: CASE_URL, fetchImpl: async () => ({ status: 404 }) });
  assert.equal(failed.error, "hub_error");
  assert.equal(failed.status, 404);
});

test("handoff: account, host and port are all checked before they reach site.env", () => {
  assert.equal(handoffValid({ host: "198.51.100.10", account: "knot-tunnel-cpswang", port: 18090 }), true);
  assert.equal(handoffValid({ host: "entry.xknot.si", account: "knot-tunnel-cpswang", port: 18081 }), true);
  // 注入：账号或主机不能带空格、分号、换行。
  assert.equal(handoffValid({ host: "h", account: "knot-tunnel-a\nKNOT_TUNNEL=0", port: 18090 }), false);
  assert.equal(handoffValid({ host: "a b", account: "acct", port: 18090 }), false);
  assert.equal(handoffValid({ host: "h", account: "acct", port: 80 }), false);
  assert.equal(handoffValid(null), false);
});

test("managed block: replaces only its own section and is idempotent", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "knot-env-"));
  assert.equal(tunnelEnvPath(dir), path.join(dir, "tunnel.env"));
  const file = tunnelEnvPath(dir);
  await writeFile(file, "# 手工加的一行留给以后\nKNOT_TUNNEL_LOCAL_PORT=9999\n");

  const block = renderManagedBlock({
    account: "knot-tunnel-cpswang",
    host: "198.51.100.10",
    port: 18090,
    localPort: 8081,
  });

  const first = await applyManagedBlock({ file, block });
  assert.equal(first.changed, true);
  const once = await readFile(file, "utf8");
  assert.match(once, /^# 手工加的一行留给以后/);
  assert.match(once, /KNOT_TUNNEL_SSH=knot-tunnel-cpswang@198\.51\.100\.10/);
  assert.match(once, /^KNOT_TUNNEL_KEY=tunnel_ed25519$/m);
  assert.match(once, /KNOT_TUNNEL_REMOTE_PORT=18090/);
  assert.match(once, /KNOT_TUNNEL_LOCAL_PORT=8081/);
  assert.ok(once.includes(MANAGED_START) && once.includes(MANAGED_END));

  const second = await applyManagedBlock({ file, block });
  assert.equal(second.changed, false, "rewriting the same block must not churn the file");

  const updated = await applyManagedBlock({ file, block: block.replace("18090", "18091") });
  assert.equal(updated.changed, true);
  const twice = await readFile(file, "utf8");
  assert.equal(twice.match(/KNOT_TUNNEL_REMOTE_PORT=/g).length, 1);
  assert.match(twice, /KNOT_TUNNEL_REMOTE_PORT=18091/);
  assert.equal(twice.match(new RegExp(MANAGED_START, "g")).length, 1);
  assert.match(twice, /^# 手工加的一行留给以后/);
});

test("managed block: the key is a bare name, so the site dir can move", () => {
  // 绝对路径会把隧道绑在「写这段时 Backend 从哪个目录跑」上：那份目录一被清理
  // （仓库换位置、部署根重建、两边同名站点各存一份），私钥文件跟着没了，入口就 502。
  // 托管段只认站点目录里的文件名，由 run-entry-tunnel.sh 按站点目录拼出绝对路径。
  const block = renderManagedBlock({
    account: "knot-tunnel-cpswang",
    host: "198.51.100.10",
    port: 18090,
    localPort: 8081,
  });
  const value = /^KNOT_TUNNEL_KEY=(.*)$/m.exec(block)?.[1];
  assert.equal(value, "tunnel_ed25519");
  assert.equal(path.isAbsolute(value), false, "托管段里不能出现绝对路径");
});

test("restart: a missing unit is reported with the command to run", async () => {
  // 标签带实例名：同一台机器上的两个实例不能共用同一个单元。
  const previous = process.env.KNOT_DEPLOY_ROOT;
  process.env.KNOT_DEPLOY_ROOT = "/Users/me/knot/wang";
  try {
    const result = await restartTunnel({
      exec: async () => {
        throw new Error("Could not find service com.knot.wang.entry-tunnel");
      },
    });
    assert.equal(result.ok, false);
    assert.match(result.command, /launchctl kickstart -k gui\/\d+\/com\.knot\.wang\.entry-tunnel/);
  } finally {
    if (previous === undefined) delete process.env.KNOT_DEPLOY_ROOT;
    else process.env.KNOT_DEPLOY_ROOT = previous;
  }
});

test("restart: a successful kickstart says so", async () => {
  const result = await restartTunnel({ exec: async () => ({}) });
  assert.equal(result.ok, true);
});

test("restart: the probe answers before anything is restarted", async () => {
  // 回包之前只许探测；真重启要等响应写完，否则这一页（可能正走隧道）会被自己掐断。
  const calls = [];
  const exec = async (cmd, args) => {
    calls.push(`${cmd} ${args.join(" ")}`);
    return {};
  };
  const previous = process.env.KNOT_DEPLOY_ROOT;
  process.env.KNOT_DEPLOY_ROOT = "/Users/me/knot/wang";
  try {
    assert.equal(await tunnelUnitInstalled({ exec }), true);
    assert.match(calls[0], /^launchctl print gui\/\d+\/com\.knot\.wang\.entry-tunnel$/);
  } finally {
    if (previous === undefined) delete process.env.KNOT_DEPLOY_ROOT;
    else process.env.KNOT_DEPLOY_ROOT = previous;
  }

  const missing = await tunnelUnitInstalled({
    exec: async () => {
      throw new Error("Could not find service");
    },
  });
  assert.equal(missing, false);
});

test("restart: a scheduled restart runs after the response, not during it", async () => {
  let ran = 0;
  scheduleTunnelRestart({ delayMs: 5, restart: async () => { ran += 1; } });
  assert.equal(ran, 0, "scheduling must not restart inline");
  // 用自己的定时器等它跑到：被排的这个是 unref 的，不能靠它撑住事件循环。
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(ran, 1);
});

test("agent plist: template placeholders are all filled", () => {
  const text = renderAgentPlist(
    "<string>__KNOT_SITE__</string><string>__KNOT_HOME__</string><string>__KNOT_CURRENT__/ops/run.sh</string><string>__KNOT_LABEL__</string>",
    {
      site: "local",
      home: "/Users/me/knot",
      current: "/Users/me/knot/current",
      label: "com.knot.wang.entry-tunnel",
    },
  );
  assert.equal(text.includes("__KNOT_"), false);
  assert.match(text, /<string>local<\/string>/);
  assert.match(text, /\/Users\/me\/knot\/current\/ops\/run\.sh/);
  // 标签必须落在 plist 里：launchd 按它 bootstrap，写错了就是「装了但没加载」。
  assert.match(text, /<string>com\.knot\.wang\.entry-tunnel<\/string>/);
});

test("agent: no template and no unit reports the command instead of pretending", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "knot-agent-"));
  const result = await startTunnelAgent({
    cwd: path.join(dir, "releases", "x", "backend"),
    site: "local",
    platform: "darwin",
    exec: async () => {
      throw new Error("Could not find service");
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.command, /run-entry-tunnel\.sh/);
});

test("deploy root: found from both the release layout and the dev layout", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "knot-root-"));
  await mkdir(path.join(root, "sites", "local"), { recursive: true });
  assert.equal(deployRootOf(path.join(root, "releases", "knot-1", "backend")), root);
  assert.equal(deployRootOf(path.join(root, "backend")), root);
});
