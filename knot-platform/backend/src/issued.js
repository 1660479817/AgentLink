// 接入件（sites/<站点>/xknot.env）的写入。
//
// 手工路径是 ops/scripts/join-xknot.sh --payload <文件>；自动路径就是这里：
// 中枢在接通验收后把 id、地址、档位与签发日给出来，实例照着写同一份文件。
// 键名与格式一律交给 @knot/config 的 renderJoinFile，不在这里另写一套。
//
// 写完要重启 Backend 才生效：进程启动时把 xknot.env source 进环境，
// 「运行中的值」才等于「文件里的值」。没装常驻单元时不假装成功，把命令交回去。

import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { statSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { checkJoin, parseEnv, renderJoinFile } from "@knot/config";

const execFileAsync = promisify(execFile);

export function joinEnvPath(siteDir) {
  return path.join(String(siteDir), "xknot.env");
}

const HOST_RE = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/i;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/;

/** 中枢给的签发区先过一遍格式；接入件写坏了整站起不来。 */
export function issuedValid(issued) {
  if (!issued || typeof issued !== "object") return false;
  const id = String(issued.id || "");
  const url = String(issued.url || "");
  if (!ID_RE.test(id)) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (!HOST_RE.test(parsed.hostname)) return false;
  // 与 packages/knot-config 的入口规则一致：只认中枢签发的 <标签>.xknot.si。
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.xknot\.si$/.test(parsed.hostname)) return false;
  // 主机名的标签就是发下来的 id，对不上说明中枢或本机有一边拿错了单。
  return parsed.hostname.split(".")[0] === id;
}

// 中枢签发的取值原样带走，只保证它是一个单行值。
function singleLine(value) {
  return String(value ?? "").replace(/[\r\n]+/g, " ").trim();
}

export function joinValues({ issued, hubOrigin, relayUrl = "", relayToken = "" }) {
  return {
    XKNOT_INSTANCE_ID: issued.id,
    XKNOT_ISSUED_URL: String(issued.url).replace(/\/+$/, ""),
    XKNOT_ISSUED_AT: String(issued.since || "").slice(0, 10),
    // 中枢没给就留空，不替它填一个。
    //
    // 这两项是中枢的决定，端侧只是回执：写进 free / active 等于替中枢做出决定，
    // 再由 /api/federation/profile 报回去，中枢读到的就是自己没说过的话。
    // 空值的含义是「中枢尚未告知」，面板与公开档案都按「未告知」显示。
    // 只去掉换行：一个值里带换行就不再是一个值，而且会往 env 文件里注入新键；
    // 这是写文件的安全处理，不是对取值的判断。
    XKNOT_ISSUED_TIER: singleLine(issued.tier),
    XKNOT_ISSUED_STATUS: singleLine(issued.status),
    XKNOT_HUB_ORIGIN: String(hubOrigin || "").replace(/\/+$/, ""),
    XKNOT_HUB_RELAY_URL: relayUrl,
    XKNOT_HUB_RELAY_TOKEN: relayToken,
  };
}

/**
 * 现有接入件里的委托发信两项。
 *
 * 自动接通只拿得到签发区（id、地址、档位、签发日）；发信凭据由中枢另行签发、
 * 只经手工写入。改写时原样带过去，否则刷新一次进度就把凭据抹掉——
 * 而且因为「键值不同」，每一轮轮询都会重写文件并重启 Backend。
 */
export async function readRelayValues(file, { read = readFile, parse = parseEnv } = {}) {
  if (!file) return { relayUrl: "", relayToken: "" };
  try {
    const env = parse(await read(file, "utf8"));
    return {
      relayUrl: String(env.XKNOT_HUB_RELAY_URL || "").trim(),
      relayToken: String(env.XKNOT_HUB_RELAY_TOKEN || "").trim(),
    };
  } catch {
    return { relayUrl: "", relayToken: "" };
  }
}

/** 接入件在不在盘上。写完到重启之间有一段窗口，这期间进程里还没有签发区。 */
export async function joinEnvPresent(file, { stat = statSync } = {}) {
  if (!file) return false;
  try {
    return stat(file).isFile();
  } catch {
    return false;
  }
}

/** 已存在且内容一致就不动文件：重启是份量很大的动作，不能每轮都做。 */
export async function writeJoinEnv({ file, values, read = readFile } = {}) {
  if (!file) return { error: "no_file" };
  const text = renderJoinFile(values);
  // 写坏了整站起不来：同一个校验器先跑一遍，不合法就一个字节都不写。
  const problems = checkJoin(text).errors;
  if (problems.length) return { error: "join_invalid", detail: problems[0] };
  let current = null;
  try {
    current = await read(file, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") return { error: "read_failed" };
  }
  // 手工写过的文件可能注释不同但键值相同；只比键值，避免把手写注释冲掉。
  if (current != null && sameKeys(current, text)) return { changed: false };

  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, text, { mode: 0o600 });
  await rename(temp, file);
  await chmod(file, 0o600);
  return { changed: true };
}

function sameKeys(left, right) {
  const pick = (text) =>
    text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^[A-Z0-9_]+=/.test(line))
      .sort()
      .join("\n");
  return pick(left) === pick(right);
}

/**
 * 找 Backend 自己的常驻单元。
 *
 * 找到了才谈重启；没找到（开发机 npm run dev）就只给命令，不动别人手里的进程。
 */
export async function backendUnit({ exec = execFileAsync, platform = process.platform } = {}) {
  const uid = process.getuid?.() ?? 501;
  const candidates =
    platform === "darwin"
      ? [
          {
            probe: ["launchctl", ["print", `gui/${uid}/com.knot.platform`]],
            command: `launchctl kickstart -k gui/${uid}/com.knot.platform`,
          },
        ]
      : [
          {
            probe: ["systemctl", ["cat", "knot-backend"]],
            command: "sudo systemctl restart knot-backend",
          },
        ];
  for (const candidate of candidates) {
    try {
      await exec(candidate.probe[0], candidate.probe[1]);
      return { installed: true, command: candidate.command };
    } catch {
      // 下一种；都不成立就是没有单元。
    }
  }
  return {
    installed: false,
    command:
      platform === "darwin"
        ? `launchctl kickstart -k gui/${uid}/com.knot.platform`
        : "sudo systemctl restart knot-backend",
  };
}

/**
 * 重启 Backend 让接入件生效。
 * 只用于「必须有结果」的场合；请求内调用请用 scheduleRestart，否则回包会被自己掐断。
 */
export async function restartBackend({ exec = execFileAsync, platform = process.platform } = {}) {
  const unit = await backendUnit({ exec, platform });
  if (!unit.installed) return { ok: false, command: unit.command };
  const args = unit.command.split(" ").slice(1);
  try {
    await exec(unit.command.split(" ")[0], args);
    return { ok: true, command: unit.command };
  } catch {
    return { ok: false, command: unit.command };
  }
}

/**
 * 延迟重启：先让当前这次 HTTP 响应写完，再把自己换掉。
 * unref 是为了不给退出留一个挂着的定时器。
 */
export function scheduleRestart({ delayMs = 700, restart = restartBackend } = {}) {
  const timer = setTimeout(() => {
    void restart().catch(() => {});
  }, delayMs);
  timer.unref?.();
  return timer;
}
