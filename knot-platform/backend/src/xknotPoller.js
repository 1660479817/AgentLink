// 端侧自动拉取：中枢把入口侧做完之后，这一侧不该等人打开管理页才去取参数。
//
// 拓扑决定方向：实例在 NAT 后面，中枢拨不进来，所以只能由实例连出去。这里是一个
// 低频轮询，只做最后两步：
//   join.json → GET /api/case/<key>/progress → 有 handoff 就写 tunnel.env → 重启隧道
//
// 与 /admin 的手动路径共用同一组函数（renderManagedBlock / applyManagedBlock），
// 所以两处同时跑也不会互相覆盖：内容一样就是 changed=false，连重启都不做。
//
// 接入件 xknot.env 仍归管理页：它要重启 Backend 才生效，而中枢探测只看 /api/health
// 里的 instance，所以少写它不影响验收成 active。那一项留给人来触发一次。
//
// 没有接入的站点连 join.json 都没有，一次文件读就结束，不发请求。

import path from "node:path";
import { access } from "node:fs/promises";

import { joinStatePath, readJoinState } from "./joinState.js";
import {
  applyManagedBlock,
  fetchProgress,
  handoffValid,
  renderManagedBlock,
  tunnelEnvPath,
  tunnelKeyPath,
} from "./tunnel.js";

export const DEFAULT_POLL_SECONDS = 60;
const MAX_POLL_SECONDS = 3600;

/**
 * 秒 → 毫秒。
 *
 * 缺省（老站点没有这个键）按默认值走，不能当成 0：升级之后隧道还在等着拉参数，
 * 却因为配置里少一行而永久停住，是最难查的一种「自动接通没接通」。
 * 写 0 才是明确关闭。
 */
export function pollIntervalMs(value = DEFAULT_POLL_SECONDS) {
  const text = String(value ?? "").trim();
  if (!text) return DEFAULT_POLL_SECONDS * 1000;
  const seconds = Number(text);
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.min(seconds, MAX_POLL_SECONDS) * 1000;
}

/**
 * 拉一次进度，必要时写隧道配置。不重启、不记日志，全部交给调用方——
 * 单测与后台循环因此共用同一条路径。
 *
 * @returns {{ skipped?: string, error?: string, changed?: boolean, run?: string|null, lastError?: string|null }}
 */
export async function pollOnce({
  profileFile,
  localPort,
  hubOrigin = "",
  readState = readJoinState,
  progress = fetchProgress,
  apply = applyManagedBlock,
  exists = existsFile,
} = {}) {
  if (!profileFile) return { skipped: "no_profile" };

  const state = await readState(joinStatePath(profileFile));
  if (!state?.application?.caseUrl) return { skipped: "no_application" };

  // 只向配置的中枢读进度：caseUrl 来自中枢响应，可能被改过（S12-02）。
  const result = await progress({ caseUrl: state.application.caseUrl, hubOrigin });
  if (result.error) return { error: result.error };

  const handoff = result.data?.handoff;
  if (!handoffValid(handoff)) {
    return {
      skipped: "not_ready",
      run: result.data?.run?.state || null,
      lastError: result.data?.run?.lastError || null,
    };
  }

  const siteDir = path.dirname(profileFile);
  // 私钥是申请时那把公钥的配对件（中枢按它写 authorized_keys），不能在这里现生成：
  // 现生成的那把没有授权，写进配置只会换来一条永远连不上的隧道。缺了就报出来。
  if (!(await exists(tunnelKeyPath(siteDir)))) return { error: "tunnel_key_missing" };

  const applied = await apply({
    file: tunnelEnvPath(siteDir),
    block: renderManagedBlock({
      account: handoff.account,
      host: handoff.host,
      port: Number(handoff.port),
      localPort,
    }),
  });
  if (applied.error) return { error: applied.error };
  return { changed: Boolean(applied.changed) };
}

async function existsFile(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * 起一个后台循环。返回 { stop }，供测试与优雅退出使用。
 *
 * 只在结果变化时记一行：每分钟一条同样的日志会把 journal 淹掉，真出事时反而
 * 找不到那次变化。
 */
export function startXknotPoller({
  profileFile,
  localPort,
  hubOrigin = "",
  intervalMs,
  restart = null,
  log = () => {},
  poll = pollOnce,
} = {}) {
  const ms = Number(intervalMs) || 0;
  if (!profileFile || ms <= 0) return { stop() {} };

  let busy = false;
  let lastNote = null;
  const note = (text) => {
    if (text === lastNote) return;
    lastNote = text;
    if (text) log(`xknot 接入：${text}`);
  };

  const tick = async () => {
    // 上一轮还没回来就跳过：中枢慢的时候不该堆起一串并发请求。
    if (busy) return;
    busy = true;
    try {
      const result = await poll({ profileFile, localPort, hubOrigin });
      if (result.error) {
        // 私钥缺失不是「中枢没消息」：它是这台机器上少了一步，得说清楚怎么办。
        note(
          result.error === "tunnel_key_missing"
            ? "缺隧道私钥 tunnel_ed25519：先打开 /admin 的 XKnot 栏交一次公钥，轮询会接着做完"
            : `自动接通没有推进（${result.error}）`
        );
      } else if (result.skipped === "not_ready") {
        note(result.lastError ? `中枢还在推进（${result.lastError}）` : `等待中枢推进（${result.run || "未知"}）`);
      } else if (result.skipped === "no_application" || result.skipped === "no_profile") {
        // 没申请过的站点每一轮都走到这里。它不是「参数已是最新」——这一侧压根
        // 还没有配置可写；在这里报一句「已是最新」只会让人以为隧道已经接上了。
        note("");
      } else if (result.changed) {
        note("隧道参数已更新，重启隧道");
        if (typeof restart === "function") {
          // 隧道重启会掐断当前连接，但这一轮没有正在回给用户的东西，
          // 所以直接做，不必像 /admin 那样等回包写完。
          const outcome = await restart().catch((error) => ({ ok: false, error: error.message }));
          if (outcome && outcome.ok === false) {
            note(`隧道没重启成功，需要手动执行一次：${outcome.command || outcome.error || "未知原因"}`);
          }
        }
      } else {
        note("隧道参数已是最新");
      }
    } catch (error) {
      note(`轮询出错（${error.message}）`);
    } finally {
      busy = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, ms);
  // 不给退出留一个挂着的定时器。
  timer.unref?.();

  return {
    stop() {
      clearInterval(timer);
    },
  };
}
