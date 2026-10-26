// 把 systemd 的 EnvironmentFile 读进当前进程。
//
// 生产上 SMTP 配置放在 `var/mail.env`，由 unit 的 `EnvironmentFile=` 读入。
// 手工在终端跑命令行时没有 systemd，同一个进程却拿不到那份取值，于是出现
// 「接口能发信、终端说没配置」——最糟的是失败发生在写库之后。
//
// 只补 process.env 里还没有的键：显式传进来的值优先，不会被文件覆盖。
// 文件不存在、读不了都按「没有这份文件」处理，不报错也不打印内容。

import { readFileSync } from "node:fs";

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function unquote(value) {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' || first === "'") && first === last) return value.slice(1, -1);
  return value;
}

/**
 * @param {string} file
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]} 实际补上的键名（只给测试和日志用，不含取值）
 */
export function loadEnvFile(file, env = process.env) {
  let text = null;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }

  const loaded = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    // systemd 只把行首的 # / ; 当注释，行内不算；这里保持一致。
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    if (!KEY_RE.test(key) || env[key] !== undefined) continue;
    env[key] = unquote(trimmed.slice(index + 1).trim());
    loaded.push(key);
  }
  return loaded;
}
