// 自动接通（端侧）：生成隧道密钥、把公钥交上去、按中枢给的参数写好隧道并拉起。
//
// 顺序是被拓扑逼出来的：实例在 NAT 后，中枢拨不进来，所以每一步都由实例主动发起。
// 这里只做四件小事，每件都能单独重试：
//   1. 第一次接入时生成一对 ed25519 密钥，私钥留在站点目录里；
//   2. 把公钥贴进案例页（与手工粘贴是同一个接口）；
//   3. 读中枢的接通进度，把错误码原样交给管理界面；
//   4. 拿到账号、端口与入口主机后，写 site.env 的托管段并重启隧道。
//
// 私钥不出本机；中枢只收到公钥。

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ACCOUNT_RE = /^[a-z][a-z0-9-]{0,30}$/;
const HOST_RE = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/i;
const KEY_FILE = "tunnel_ed25519";

export const MANAGED_START = "# >>> XKnot 自动接通（由管理界面写入，勿手改）";
export const MANAGED_END = "# <<< XKnot 自动接通";

export function tunnelKeyPath(siteDir) {
  return path.join(String(siteDir), KEY_FILE);
}

// 隧道托管件与 site.env 分开放：
// site.env 归 deploy-site.sh 管（入口开关、公开地址、站点身份），
// tunnel.env 归 /admin 的 XKnot 栏管（账号、端口、私钥）。两拨人改同一个文件早晚互相盖。
export function tunnelEnvPath(siteDir) {
  return path.join(String(siteDir), "tunnel.env");
}

/** 已有公钥就用它，没有才生成；重复调用不会换掉正在用的密钥。 */
export async function ensureTunnelKey({ file, comment = "knot-tunnel", exec = execFileAsync } = {}) {
  if (!file) return { error: "no_file" };
  try {
    const publicKey = (await readFile(`${file}.pub`, "utf8")).trim();
    if (publicKey) return { publicKey, created: false };
  } catch {
    // 还没有，往下生成。
  }

  await mkdir(path.dirname(file), { recursive: true });
  try {
    await exec("ssh-keygen", ["-t", "ed25519", "-N", "", "-C", comment, "-f", file]);
    await chmod(file, 0o600);
    const publicKey = (await readFile(`${file}.pub`, "utf8")).trim();
    if (!publicKey) return { error: "keygen_failed" };
    return { publicKey, created: true };
  } catch (error) {
    return { error: "keygen_failed", detail: error.message };
  }
}

/** 案例链接 → 同一能力键下的接口地址。只接受 http(s) 与纯键名。
 *
 * 给了 hubOrigin 就把 origin 钉死在中枢上：caseUrl 来自中枢响应（写进 join.json），
 * 是远端可控的数据。不比对 origin 时，一个响应过申请的中枢、或被改过的 join.json，
 * 就能让实例对它发 GET .../progress 与 POST .../public-key（S12-02）。
 */
export function caseEndpoint(caseUrl, action, hubOrigin = "") {
  let url;
  try {
    url = new URL(String(caseUrl || ""));
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const hub = String(hubOrigin || "").trim().replace(/\/+$/, "");
  if (hub) {
    let allowed;
    try {
      allowed = new URL(hub);
    } catch {
      return null;
    }
    if (allowed.origin !== url.origin) return null;
  }
  const match = /^\/case\/([A-Za-z0-9_-]{6,64})\/?$/.exec(url.pathname);
  if (!match) return null;
  return `${url.origin}/api/case/${match[1]}/${action}`;
}

export async function submitPublicKey({ caseUrl, publicKey, hubOrigin = "", fetchImpl = fetch } = {}) {
  const target = caseEndpoint(caseUrl, "public-key", hubOrigin);
  if (!target) return { error: "bad_case_url" };
  const body = new URLSearchParams({ publicKey: String(publicKey || "").trim() }).toString();
  try {
    const response = await fetchImpl(target, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    // 中枢受理后回 303 到案例页；非 3xx/2xx 说明键格式或键本身不对。
    if (response.status === 303 || response.status === 200) return { ok: true };
    return { error: "rejected", status: response.status };
  } catch (error) {
    return { error: "unreachable", detail: error.message };
  }
}

export async function fetchProgress({ caseUrl, hubOrigin = "", fetchImpl = fetch } = {}) {
  const target = caseEndpoint(caseUrl, "progress", hubOrigin);
  if (!target) return { error: "bad_case_url" };
  try {
    const response = await fetchImpl(target, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status !== 200) return { error: "hub_error", status: response.status };
    return { ok: true, data: await response.json() };
  } catch (error) {
    return { error: "unreachable", detail: error.message };
  }
}

export function handoffValid(handoff) {
  if (!handoff || typeof handoff !== "object") return false;
  const account = String(handoff.account || "");
  const host = String(handoff.host || "");
  const port = Number(handoff.port);
  return ACCOUNT_RE.test(account) && HOST_RE.test(host) && Number.isInteger(port) && port >= 1024 && port <= 65535;
}

/**
 * 写进 tunnel.env 的那一段。键名与 site-config.sh / run-entry-tunnel.sh 读的一致。
 *
 * 私钥只记文件名，不记绝对路径：托管段与密钥同住一个站点目录，站点目录在仓库、
 * 在部署根、还是被整份搬走，隧道都读自己旁边那把钥匙。写绝对路径就绑死了「当时
 * 从哪个目录跑 Backend」——一旦那份目录被清理或换位置，密钥跟着消失，入口直接 502。
 */
export function renderManagedBlock({ account, host, port, localPort }) {
  return `${MANAGED_START}
KNOT_TUNNEL=1
KNOT_TUNNEL_SSH=${account}@${host}
KNOT_TUNNEL_KEY=${KEY_FILE}
KNOT_TUNNEL_REMOTE_PORT=${port}
KNOT_TUNNEL_LOCAL_PORT=${localPort}
${MANAGED_END}`;
}

/**
 * 只替换托管段，文件里其它内容与注释保持原样。
 * 没有托管段就追加；重复写入同一份内容时 changed 为 false。
 */
export async function applyManagedBlock({ file, block } = {}) {
  if (!file) return { error: "no_file" };
  let current = "";
  try {
    current = await readFile(file, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") return { error: "read_failed" };
  }

  const start = current.indexOf(MANAGED_START);
  const end = current.indexOf(MANAGED_END);
  let next;
  if (start >= 0 && end > start) {
    next = `${current.slice(0, start)}${block}${current.slice(end + MANAGED_END.length)}`;
  } else if (start >= 0) {
    // 只剩 START、没有配对的 END：文件被手工截断或写入中途断电。
    // 从 START 处截掉尾部再写，否则会把第二段托管块追加在后面（S12-15）。
    const head = current.slice(0, start).trimEnd();
    next = `${head}${head ? "\n\n" : ""}${block}\n`;
  } else {
    // 孤立的 END（没有 START）也要带走，免得文件里留下半截标记。
    const kept = end >= 0 ? `${current.slice(0, end)}${current.slice(end + MANAGED_END.length)}` : current;
    next = `${kept.trimEnd()}${kept.trim() ? "\n\n" : ""}${block}\n`;
  }

  if (next === current) return { changed: false };
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, next, { mode: 0o600 });
  await rename(temp, file);
  return { changed: true };
}

/** 隧道私钥在不在。中枢按申请时那把公钥授权，缺了写配置只会换到一条连不上的隧道。 */
export function tunnelKeyPresent(siteDir) {
  const dir = String(siteDir || "").trim();
  return Boolean(dir) && existsSync(tunnelKeyPath(dir));
}

/** 托管段写进去了没有。只读文件，判不出隧道进程通不通——那是中枢探测的事。 */
export async function managedBlockPresent({ file, read = readFile } = {}) {
  if (!file) return false;
  try {
    return String(await read(file, "utf8")).includes(MANAGED_START);
  } catch {
    return false;
  }
}

/**
 * 让隧道进程用上新配置。装了常驻单元就重启它；没有单元时不假装成功，
 * 把命令交给调用方显示，人照着跑一次即可。
 *
 * main 只支持 macOS + launchd：隧道也是实例主机上的 LaunchAgent。
 */
export async function restartTunnel({ exec = execFileAsync } = {}) {
  const [cmd, args] = tunnelUnitCommand();
  try {
    await exec(cmd, args);
    return { ok: true, command: `${cmd} ${args.join(" ")}` };
  } catch {
    // 没装单元是正常情况（开发机、只部署了 Backend）：把命令交回去。
    return { ok: false, command: `${cmd} ${args.join(" ")}` };
  }
}

function tunnelUnitCommand() {
  const uid = process.getuid?.() ?? 501;
  return ["launchctl", ["kickstart", "-k", `gui/${uid}/com.knot.entry-tunnel`]];
}

/** 隧道有没有常驻单元。只探测，不动进程：要的是能在回包之前说真话。 */
export async function tunnelUnitInstalled({ exec = execFileAsync } = {}) {
  const uid = process.getuid?.() ?? 501;
  try {
    await exec("launchctl", ["print", `gui/${uid}/com.knot.entry-tunnel`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * 延迟重启隧道。
 *
 * 管理页很可能就是经这条隧道进来的：在请求里重启，等于把回包连着自己一起掐掉，
 * 浏览器只会看到一个 502。所以先让响应写完，再换隧道。
 */
export function scheduleTunnelRestart({ delayMs = 700, restart = startTunnelAgent } = {}) {
  const timer = setTimeout(() => {
    void restart().catch(() => {});
  }, delayMs);
  timer.unref?.();
  return timer;
}

const PLIST_LABEL = "com.knot.entry-tunnel";

/**
 * 从 Backend 的 cwd 反推部署根。
 *
 * 两种布局都要认：
 *   <root>/releases/<版本>/backend   发布包
 *   <root>/backend                   开发机上直接跑源码
 * 所以不数层数，向上找带 sites/ 的那一层（sites/ 是站点配置的家，哪一层有它就是哪一层）。
 */
export function deployRootOf(cwd = process.cwd()) {
  let dir = path.resolve(String(cwd));
  for (let depth = 0; depth < 5; depth += 1) {
    if (existsSync(path.join(dir, "sites"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(String(cwd), "..");
}

export function renderAgentPlist(template, { site, home, current }) {
  return String(template)
    .replaceAll("__KNOT_SITE__", site)
    .replaceAll("__KNOT_HOME__", home)
    .replaceAll("__KNOT_CURRENT__", current);
}

/**
 * 部署时没装隧道单元（例如填写申请那一刻站点还没接通），这里补装一次：
 * 只写用户自己的 LaunchAgent，不动系统目录；已装过就直接重启。
 *
 * 拿不到模板时返回 ok:false 与一条可复制的启动命令。
 */
export async function startTunnelAgent({
  cwd = process.cwd(),
  site = process.env.KNOT_SITE || "",
  exec = execFileAsync,
} = {}) {
  const restarted = await restartTunnel({ exec });
  if (restarted.ok) return restarted;

  if (!site) return restarted;

  const root = deployRootOf(cwd);
  const template = path.join(root, "current", "ops", "launchd", `${PLIST_LABEL}.plist`);
  let source;
  try {
    source = await readFile(template, "utf8");
  } catch {
    return { ...restarted, command: "bash ops/scripts/run-entry-tunnel.sh" };
  }

  const plist = renderAgentPlist(source, {
    site,
    home: root,
    current: path.join(root, "current"),
  });
  const target = path.join(os.homedir(), "Library", "LaunchAgents", `${PLIST_LABEL}.plist`);
  const uid = process.getuid?.() ?? 501;
  try {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, plist, { mode: 0o644 });
    await exec("launchctl", ["bootout", `gui/${uid}/${PLIST_LABEL}`]).catch(() => {});
    await exec("launchctl", ["bootstrap", `gui/${uid}`, target]);
    await exec("launchctl", ["kickstart", "-k", `gui/${uid}/${PLIST_LABEL}`]);
    return { ok: true, command: `launchctl kickstart -k gui/${uid}/${PLIST_LABEL}`, installed: true };
  } catch {
    return { ...restarted, command: `launchctl bootstrap gui/${uid} ${target}` };
  }
}
