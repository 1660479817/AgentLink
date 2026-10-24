// 浏览器里留一份公开快照，刷新后先画它，再去入口取新的。
//
// 入口与实例之间隔着一条跨境隧道，一次 `/api/web/*` 往返要接近一秒。
// 首屏能不等那次往返，靠的就是这一份：内容与 `/discover.json` 完全相同，
// 只是换成读本机的 localStorage，几十毫秒就能画出来。

export const BOARD_CACHE_KEY = "knot.board";

// 超过一天就不再用：快照里的 wish 有有效期，放太久会把已经过期的卡片画出来。
export const BOARD_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function browserStorage() {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

function isBoard(value) {
  return Array.isArray(value?.information) && Array.isArray(value?.requests);
}

export function readBoardCache(storage, now = Date.now()) {
  try {
    const raw = storage?.getItem(BOARD_CACHE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!isBoard(saved?.board)) return null;
    const savedAt = Number(saved?.savedAt) || 0;
    if (!savedAt || now - savedAt > BOARD_CACHE_MAX_AGE_MS || now < savedAt) return null;
    if (!Array.isArray(saved.board.people)) saved.board.people = [];
    return saved.board;
  } catch {
    return null;
  }
}

export function writeBoardCache(storage, board, now = Date.now()) {
  if (!isBoard(board)) return false;
  try {
    if (!storage) return false;
    storage.setItem(BOARD_CACHE_KEY, JSON.stringify({ savedAt: now, board }));
    return true;
  } catch {
    // 无痕模式或空间满了：缓存失败不影响这一次浏览。
    return false;
  }
}

export function clearBoardCache(storage) {
  try {
    storage?.removeItem(BOARD_CACHE_KEY);
  } catch {
    // private mode
  }
}

/** 快照里的站点开关，给首帧决定「要不要停在登录页」用。 */
export function cachedSite(board) {
  const site = board?.site;
  if (!site || typeof site !== "object") return null;
  return {
    guestBrowsing: site.guestBrowsing !== false,
    registrationMode: typeof site.registrationMode === "string" ? site.registrationMode : "open",
    publicBoard: site.publicBoard !== false,
  };
}

/** 快照里的站点身份，给顶栏和登录卡先用着。 */
export function cachedBrand(board) {
  const brand = board?.brand;
  if (!brand || typeof brand !== "object") return null;
  return brand;
}
