// 探测地址与「要不要探」都由契约推出，不再写进清单。
//
// 地址只有一个来源：清单条目的 url，即中枢签发的 https://<标签>.xknot.si。
// 探测地址是 url + /api/health。
//
// 探不探只看清单的 status：
//   pending  —— 已写进清单、尚未通过 /api/health 验收。不探，走「从未接通」计时。
//   active   —— 正常探测。
//   其它     —— 暂停 / 退役，不探，保留上一次结果。

export const PROBE_PATH = "/api/health";

/**
 * 从清单条目推出探测地址。缺少 url 或不是 https 时返回 null。
 * @param {{url?: string}} instance
 * @returns {string|null}
 */
export function healthUrlOf(instance) {
  const raw = String(instance?.url || "").trim();
  if (!raw) return null;
  try {
    const base = new URL(raw);
    if (base.protocol !== "https:") return null;
    if (base.username || base.password) return null;
    // url 里若带了路径，一律收敛到站点根下的 /api/health。
    return new URL(PROBE_PATH, `${base.origin}/`).toString();
  } catch {
    return null;
  }
}

/**
 * 这个实例现在要不要探测。
 * @param {{status?: string}|null|undefined} instance
 */
export function probeEnabled(instance) {
  return instance?.status === "active";
}

/**
 * 一次算完：探不探、探哪里。
 * @param {{id?: string, url?: string, status?: string}} instance
 * @returns {{enabled: boolean, url: string|null}}
 */
export function probeTargetOf(instance) {
  const url = healthUrlOf(instance);
  return { enabled: Boolean(url) && probeEnabled(instance), url };
}
