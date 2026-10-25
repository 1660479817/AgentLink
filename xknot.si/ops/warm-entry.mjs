// 入口缓存预热：接通那一刻把首页与它引用的静态资源取一遍，替第一个访客付掉
// 这一次跨境往返。
//
// 页面骨架靠实例回源，缓存只有 10 秒，过期后由后台刷新兜着，所以它只冷一次。
// 真正只冷一次的是带哈希名的资产：入口按 30 天留，但第一个人没来之前谁也没存过。
// 个人站没有「很多人分摊第一次」，所以这里主动走一遍公网入口，让 nginx 自己把它们存下。
//
// 必须走公网入口（https://<子域>/）而不是隧道端口：只穿隧道不够，nginx 的缓存
// 是因为有请求从它这里过才被填满的。

export const MAX_WARM_ASSETS = 12;
// 一份构建通常只有一张样式表，字体路径都在里面。给个上限是为了让最坏情况有界：
// 这些请求是串行取的，每张都可能耗到超时。
export const MAX_WARM_SHEETS = 4;

const ASSET_IN_HTML = /(?:src|href)="(\/assets\/[^"]+)"/g;
const ASSET_IN_CSS = /url\(\s*['"]?(\/assets\/[^'")\s]+)/g;

/** 只认构建产物目录下的路径：`..` 与协议相对的写法都不预热。 */
function usable(path) {
  return typeof path === "string" && path.startsWith("/assets/") && !path.includes("..") && !path.includes("//");
}

function matches(text, pattern) {
  const found = [];
  for (const match of String(text || "").matchAll(pattern)) {
    if (usable(match[1]) && !found.includes(match[1])) found.push(match[1]);
  }
  return found;
}

/** 首页与样式表里引用的构建产物路径，按出现顺序去重。 */
export function assetPaths(html, css = [], limit = MAX_WARM_ASSETS) {
  const paths = matches(html, ASSET_IN_HTML);
  for (const sheet of css) {
    for (const path of matches(sheet, ASSET_IN_CSS)) {
      if (!paths.includes(path)) paths.push(path);
    }
  }
  return paths.slice(0, limit);
}

/**
 * @returns {{ home: boolean, assets: number, warmed: number, error?: string }}
 */
export async function warmEntry({ origin, fetchImpl = fetch, limit = MAX_WARM_ASSETS, timeoutMs = 10_000 } = {}) {
  const base = String(origin || "").replace(/\/+$/, "");
  if (!/^https?:\/\//.test(base)) return { home: false, assets: 0, warmed: 0, error: "bad_origin" };

  const get = (path) => fetchImpl(`${base}${path}`, { signal: AbortSignal.timeout(timeoutMs) });

  let html = "";
  try {
    const response = await get("/");
    if (!response.ok) return { home: false, assets: 0, warmed: 0, error: "home_failed" };
    html = await response.text();
  } catch {
    return { home: false, assets: 0, warmed: 0, error: "unreachable" };
  }

  // 样式表里还挂着字体，先单独取回来才能拿到那些路径。这一趟同时把它们放进了入口缓存，
  // 所以后面不再重复请求它们。
  const sheets = new Map();
  for (const path of matches(html, ASSET_IN_HTML).slice(0, limit)) {
    if (!path.endsWith(".css")) continue;
    if (sheets.size >= MAX_WARM_SHEETS) break;
    try {
      const response = await get(path);
      if (response.ok) sheets.set(path, await response.text());
    } catch {
      /* 一个样式表取不到，不影响其余资产 */
    }
  }

  const assets = assetPaths(html, [...sheets.values()], limit);
  const pending = assets.filter((path) => !sheets.has(path));
  const results = await Promise.all(pending.map((path) => get(path).then((r) => r.ok).catch(() => false)));
  return { home: true, assets: assets.length, warmed: sheets.size + results.filter(Boolean).length };
}
