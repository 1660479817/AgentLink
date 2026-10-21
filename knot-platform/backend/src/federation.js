// XKnot 接入信息与状态信号。只读，不改任何文件。
//
// 接入件在 sites/<站点>/xknot.env（权限 600），部署时由 join-xknot.sh 写入；
// 进程启动时把它 source 进环境，Backend 只从环境里读。所以这里同时给出两份值：
//   * running —— 进程里现在生效的值，也是中枢在 /api/health 里会看到的那一份；
//   * stored  —— 接入件里写的值。两份不一致，说明改过文件但还没重启。
// 中枢那边的探测结果（up / down / instance_mismatch）写在它自己的
// var/health.json 里，实例读不到，这里只说明这台会对外报什么。

import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { checkJoin, parseEnv } from "@knot/config";
import { relayUrl } from "./login.js";

const KEYS = [
  { key: "XKNOT_INSTANCE_ID", label: "实例 id" },
  { key: "XKNOT_ISSUED_URL", label: "签发地址" },
  { key: "XKNOT_ISSUED_AT", label: "签发日" },
  { key: "XKNOT_TIER", label: "层级" },
  { key: "XKNOT_STATUS", label: "状态" },
  { key: "XKNOT_HUB_ORIGIN", label: "中枢地址" },
  { key: "XKNOT_HUB_RELAY_URL", label: "委托发信地址" },
  { key: "XKNOT_HUB_RELAY_TOKEN", label: "委托发信凭据" },
];

const LEVEL_ORDER = { error: 0, warn: 1, info: 2, ok: 3 };

function text(value) {
  return String(value ?? "").trim();
}

// 凭据只显示前后各一小段，和 join-xknot.sh --status 一致。
export function maskSecret(value) {
  const raw = text(value);
  if (!raw) return "";
  if (raw.length <= 12) return "****";
  return `${raw.slice(0, 8)}…${raw.slice(-4)}`;
}

// 定位接入件。部署脚本把 KNOT_AGENT_ENV_DIR 写成
// <部署根>/sites/<站点>/agents，它的上级目录就是站点目录。
export function xknotEnvPath(env = process.env, agentEnvDir = null) {
  const explicit = text(env.KNOT_XKNOT_ENV);
  if (explicit) return path.resolve(explicit);
  const dir = text(agentEnvDir);
  if (dir) return path.join(path.dirname(dir), "xknot.env");
  return null;
}

// 读接入件本身。不存在不是错误：没接入的站点照样部署和运行。
export function readJoinFile(file, { readFile = readFileSync, stat = statSync } = {}) {
  if (!file) return { path: null, exists: false, text: "", mode: null, error: null };
  try {
    const info = stat(file);
    return { path: file, exists: true, text: readFile(file, "utf8"), mode: info.mode & 0o777, error: null };
  } catch (error) {
    if (error.code === "ENOENT") return { path: file, exists: false, text: "", mode: null, error: null };
    return { path: file, exists: false, text: "", mode: null, error: error.code || "read_failed" };
  }
}

function permissions(mode) {
  if (mode == null) return null;
  return `0${mode.toString(8)}`;
}

function configView(source) {
  const instanceId = text(source.XKNOT_INSTANCE_ID);
  const hubOrigin = text(source.XKNOT_HUB_ORIGIN).replace(/\/+$/, "");
  const explicitRelay = text(source.XKNOT_HUB_RELAY_URL);
  const token = text(source.XKNOT_HUB_RELAY_TOKEN);
  return {
    instanceId,
    issuedUrl: text(source.XKNOT_ISSUED_URL).replace(/\/+$/, ""),
    hubOrigin,
    relayUrl: relayUrl(source),
    relayUrlSource: explicitRelay ? "explicit" : hubOrigin ? "derived" : "none",
    issuedAt: text(source.XKNOT_ISSUED_AT),
    tier: text(source.XKNOT_TIER),
    status: text(source.XKNOT_STATUS),

    relayToken: {
      present: Boolean(token),
      masked: maskSecret(token),
    },
  };
}

function driftBetween(runningSource, storedSource) {
  const drift = [];
  for (const entry of KEYS) {
    const running = text(runningSource[entry.key]);
    const stored = text(storedSource[entry.key]);
    if (running === stored) continue;
    const secret = entry.key.endsWith("_TOKEN");
    drift.push({
      key: entry.key,
      label: entry.label,
      running: secret ? maskSecret(running) : running,
      stored: secret ? maskSecret(stored) : stored,
    });
  }
  return drift;
}

function healthView(running, publicWebOrigin) {
  const origin = text(publicWebOrigin).replace(/\/+$/, "");
  const url = origin ? `${origin}/api/health` : "";
  const privateAddress = /^(https?:\/\/)(localhost|127\.|\[::1\]|0\.0\.0\.0)/i.test(origin);
  return {
    url,
    https: url.startsWith("https://"),
    privateAddress,
    instance: running.instanceId || null,
    reportsInstance: Boolean(running.instanceId),
  };
}

function mailView(running, env) {
  const relay = Boolean(running.relayUrl && running.relayToken.present);
  const smtp = Boolean(text(env.SMTP_HOST));
  return {
    mode: relay ? "relay" : smtp ? "smtp" : "none",
    relayUrl: running.relayUrl,
    relayConfigured: relay,
    smtpConfigured: smtp,
  };
}

export function federationStatus({
  env = process.env,
  agentEnvDir = null,
  publicWebOrigin = "",
  joinFile = null,
  now = () => new Date(),
} = {}) {
  const file = joinFile || readJoinFile(xknotEnvPath(env, agentEnvDir));
  const fileEnv = file.exists ? parseEnv(file.text) : {};
  const running = configView(env);
  const stored = file.exists ? configView(fileEnv) : null;
  const drift = stored ? driftBetween(env, fileEnv) : [];
  const health = healthView(running, publicWebOrigin);
  const mail = mailView(running, env);

  const signals = [];
  const push = (level, code, message) => signals.push({ level, code, text: message });

  if (!file.exists) {
    if (file.error) {
      push("warn", "join_file_unreadable", `读不到接入文件（${file.error}）：${file.path || "没有定位到站点目录"}`);
    }
    if (running.instanceId || running.hubOrigin || running.relayToken.present) {
      push(
        "warn",
        "running_without_file",
        `进程里有接入值，但没找到接入文件（${file.path || "没有定位到站点目录"}）。这些值不是从文件读的——如果是从容器或服务环境注入的，可以忽略这一条；如果不是，下次重启会丢。`
      );
    } else {
      push("info", "not_joined", "未接入 XKnot。部署与运行不受影响；要接入用 ops/scripts/join-xknot.sh 写入接入件。");
    }
  } else {
    const checked = checkJoin(file.text, { mode: file.mode });
    for (const message of checked.errors) push("error", "join_file", message);
    for (const message of checked.warnings) push("warn", "join_file", message);
    if (drift.length) {
      push(
        "warn",
        "restart_required",
        "接入件里的值和进程里的不一致：现在跑的是进程里的值，重启 Backend 才会换成文件里的值。"
      );
    }
  }

  if (running.relayToken.present && !running.hubOrigin) {
    push("warn", "relay_without_origin", "有委托发信凭据，但没有中枢地址：推导不出委托发信地址，发信会退回本机 SMTP。");
  }

  if (health.reportsInstance && health.url) {
    if (health.privateAddress) {
      push("info", "health_private", "对外地址是回环地址：只有本机能访问，中枢探测不到这一台。");
    } else if (!health.https) {
      push("warn", "health_not_https", "对外地址不是 https：中枢探测只接受 https，这一台会被判 unknown。");
    }
  }
  if (!health.reportsInstance && health.url && !health.privateAddress) {
    push("info", "no_instance", "没报 instance：中枢只按 ok 判活，不核对清单里的 id。");
  }

  if (mail.mode === "none") {
    push("warn", "mail_unavailable", "既没有委托发信凭据，也没有配置 SMTP_HOST：登录密钥寄不出去。");
  }

  if (file.exists && !signals.some((signal) => signal.level === "error" || signal.level === "warn")) {
    push("ok", "joined", "接入件齐全，/api/health 会报出 instance。");
  }

  signals.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);

  return {
    checkedAt: now().toISOString(),
    joined: file.exists || Boolean(running.instanceId),
    file: {
      path: file.path,
      exists: file.exists,
      permissions: permissions(file.mode),
      error: file.error,
    },
    running,
    stored,
    drift,
    mail,
    health,
    signals,
  };
}
