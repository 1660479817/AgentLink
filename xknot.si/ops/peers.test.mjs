import assert from "node:assert/strict";
import test from "node:test";

import { collectPeers, parsePs, parseSs, tunnelPeers } from "./peers.mjs";

// 真实的 `sudo ss -tnp state established '( sport = :22 )'` 输出（节选）。
// 第一行是表头，最后一行是笔记本上的访客自己开会话，不该被算成实例。
const SS = `Recv-Q Send-Q Local Address:Port   Peer Address:Port Process
0      0      172.31.46.109:22   119.123.195.96:23475 users:(("sshd-session",pid=190681,fd=4),("sshd-session",pid=190678,fd=4))
0      0      172.31.46.109:22   119.123.195.96:23925 users:(("sshd-session",pid=190746,fd=4))
0      0      172.31.46.109:22   203.0.113.7:51515 users:(("sshd-session",pid=231001,fd=4))
0      0      172.31.46.109:22   [2001:db8::99]:40001 users:(("sshd-session",pid=193384,fd=4))
`;

const PS = ` 190681 sshd-session: knot-tunnel@notty
 190678 sshd-session: knot-tunnel [priv]
 190746 sshd-session: knot-tunnel-cpswang@notty
 193384 sshd-session: knot-tunnel-example
 231001 sshd-session: ec2-user@pts/2
`;

const MEMBERS = [
  { id: "wang", tunnel: { account: "knot-tunnel" } },
  { id: "cpswang", tunnel: { account: "knot-tunnel-cpswang" } },
  { id: "example", tunnel: { account: "knot-tunnel-example" } },
];

test("ss rows keep the peer address and the pid, and skip the header", () => {
  const rows = parseSs(SS);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0], { ip: "119.123.195.96", pid: 190681 });
  // IPv6 的对端列带方括号，只留地址。
  assert.equal(rows[3].ip, "2001:db8::99");
});

test("three sshd process names count: the -N session, the priv monitor, and a bare name", () => {
  const sessions = parsePs(PS);
  assert.equal(sessions.get(190681), "knot-tunnel");
  assert.equal(sessions.get(190678), "knot-tunnel");
  // 刚连上、还没打上 @notty 的那种，线上真的出现过：漏一种就少一个实例。
  assert.equal(sessions.get(193384), "knot-tunnel-example");
  assert.equal(sessions.get(231001), "ec2-user");
});

test("only roster tunnel accounts become ids; other logins are ignored", () => {
  const peers = tunnelPeers({ ss: SS, ps: PS, members: MEMBERS });
  assert.deepEqual(peers, {
    wang: { ip: "119.123.195.96", account: "knot-tunnel" },
    cpswang: { ip: "119.123.195.96", account: "knot-tunnel-cpswang" },
    example: { ip: "2001:db8::99", account: "knot-tunnel-example" },
  });
  // ec2-user 是运营者自己的会话，地址再像也不参与。
  assert.equal(Object.keys(peers).length, 3);
});

test("a member whose tunnel is down simply has no peer", () => {
  const peers = tunnelPeers({ ss: SS, ps: PS, members: [...MEMBERS, { id: "ghost", tunnel: { account: "knot-tunnel-ghost" } }] });
  assert.equal(peers.ghost, undefined);
});

test("permission problems are reported, not turned into an empty map", async () => {
  const calls = [];
  const result = await collectPeers({
    members: MEMBERS,
    exec: async (file, argv) => {
      calls.push([file, ...argv].join(" "));
      throw new Error("sudo: a password is required");
    },
  });
  assert.equal(result.error, "ss_failed");
  assert.match(result.detail, /password/);
  assert.equal(calls.length, 1);
});

test("collection pairs ss with ps through sudo", async () => {
  const calls = [];
  const result = await collectPeers({
    members: MEMBERS,
    exec: async (file, argv) => {
      calls.push([file, ...argv].join(" "));
      return { stdout: argv.includes("ps") ? PS : SS };
    },
  });
  assert.equal(result.error, null);
  assert.equal(result.peers.cpswang.ip, "119.123.195.96");
  assert.match(calls[0], /sudo -n ss -tnp/);
  assert.match(calls[1], /sudo -n ps -ww/);
  // 一次把所有 pid 交给 ps，不逐个起进程。
  assert.match(calls[1], /-p 190681,190746,231001,193384/);
});
