// 隧道对端：入口主机上每条 SSH 会话的对端地址，就是实例真实的出口 IP。
//
// 实例都在 NAT 后面，中枢拨不进去，所以连接一律是实例连出的。那条连接的对端
// 地址由入口主机的内核记着：`ss -tnp` 给出 socket 与 pid，`ps` 给出这条会话用的
// 隧道账号，账号 → 实例 id 的映射在 federation.json 的名册里。
//
// 为什么不用别的办法：
//   * 探活是中枢 → 入口 → 隧道 → 实例，中枢看到的源地址永远是入口主机自己；
//   * 让实例自报 IP 要多一个接口、多一次外部查询，还得信它的说法；
//   * 隧道对端是现成的事实：不新增接口，实例侧一行代码都不用改。
//
// 这套只在「中枢与入口同一台机器」时可用（见 docs/HUB.md）。读不到就当没有：
// 页面回落到自述区写的 region，不猜。
//
// 一个账号同时开了多条会话（重连残留）时，取第一条出现的地址。多条会话来自
// 不同地址说明它正在漂移，下一次采集自然收敛到最新那条。

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const SSH_PORT = 22;

// `ss -tnp` 的行：Recv-Q Send-Q Local Peer Process。
// Process 形如 users:(("sshd-session",pid=190681,fd=4),…)，只有 root 看得到 pid。
export function parseSs(text) {
  const rows = [];
  for (const line of String(text || "").split("\n")) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 5) continue;
    const pid = /pid=(\d+)/.exec(cols.slice(4).join(" "));
    if (!pid) continue;
    const peer = hostOf(cols[3]);
    if (peer) rows.push({ ip: peer, pid: Number(pid[1]) });
  }
  return rows;
}

// 对端列可能是 1.2.3.4:5678、[2001:db8::1]:5678 或 *:*。
function hostOf(address) {
  const text = String(address || "");
  if (!text) return null;
  if (text.startsWith("[")) {
    const end = text.indexOf("]");
    if (end < 0) return null;
    const ip = text.slice(1, end);
    return ip.includes(":") ? ip : null;
  }
  const cut = text.lastIndexOf(":");
  const ip = cut > 0 ? text.slice(0, cut) : text;
  if (!/\d/.test(ip)) return null;
  if (ip === "0.0.0.0" || ip === "*") return null;
  return ip;
}

// `ps -ww -o pid=,command=` 的行。sshd 把登录名写进进程名：
//   sshd-session: knot-tunnel@notty        隧道本身（ssh -N）
//   sshd-session: knot-tunnel [priv]        特权监视进程
//   sshd-session: knot-tunnel              刚起、还没打上 @notty 的那一瞬
// 三种都要认：先看到哪一条不由我们决定，漏一种就会少一个实例。
const SESSION_CMD = /^sshd-session: ([^@\s]+)(?:@\S+)?(?: \[priv\])?$/;

export function parsePs(text) {
  const byPid = new Map();
  for (const line of String(text || "").split("\n")) {
    const row = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!row) continue;
    const name = SESSION_CMD.exec(row[2].trim());
    if (name) byPid.set(Number(row[1]), name[1]);
  }
  return byPid;
}

/**
 * ss 与 ps 的结果合起来，得到「实例 id → 隧道账号与出口 IP」。
 * 只有名册里登记了 tunnel.account 的条目才算：别人的登录会话不参与。
 *
 * @param {{ ss: string, ps: string, members: unknown[] }} input
 * @returns {Record<string, { ip: string, account: string }>}
 */
export function tunnelPeers({ ss, ps, members = [] }) {
  const accountOf = new Map();
  for (const member of members) {
    const account = member?.tunnel?.account;
    if (typeof account === "string" && account) accountOf.set(account, member.id);
  }
  const sessions = parsePs(ps);
  const seen = new Map();
  for (const row of parseSs(ss)) {
    const account = sessions.get(row.pid);
    if (!account) continue;
    const id = accountOf.get(account);
    if (!id || seen.has(id)) continue;
    seen.set(id, { ip: row.ip, account });
  }
  return Object.fromEntries(seen);
}

// 采集只在入口主机上有意义，而且必须看得见不属于自己的 socket，所以要 root。
// 权限不够时返回 error，调用方保留上一次的结果，不要写空文件把已知的地址抹掉。
export async function collectPeers({ members = [], exec = execFileAsync, port = SSH_PORT } = {}) {
  let ss;
  try {
    const result = await exec("sudo", ["-n", "ss", "-tnp", "state", "established", `( sport = :${port} )`], {
      timeout: 10_000,
    });
    ss = result.stdout;
  } catch (error) {
    return { error: "ss_failed", detail: String(error?.message || error).slice(0, 200), peers: {} };
  }

  const pids = [...new Set(parseSs(ss).map((row) => row.pid))];
  if (!pids.length) return { error: null, peers: {} };

  let ps = "";
  try {
    const result = await exec("sudo", ["-n", "ps", "-ww", "-o", "pid=,command=", "-p", pids.join(",")], {
      timeout: 10_000,
    });
    ps = result.stdout;
  } catch (error) {
    return { error: "ps_failed", detail: String(error?.message || error).slice(0, 200), peers: {} };
  }

  return { error: null, peers: tunnelPeers({ ss, ps, members }) };
}
