import { browserStorage, writeBoardCache } from "./boardCache.js";

const hidden = new Set();
let memory = null;
let aheadFeed = null;
let aheadIds = new Set();

export function rememberDiscover(board) {
  memory = board;
}

export function readDiscoverMemory() {
  return memory;
}

export function rememberAhead(board) {
  if (!board) {
    aheadFeed = null;
    aheadIds = new Set();
    return;
  }
  const known = new Set((memory?.information || []).map((item) => item?.id).filter(Boolean));
  const fresh = (board.information || []).map((item) => item?.id).filter((id) => id && !known.has(id));
  if (!fresh.length) {
    aheadFeed = null;
    aheadIds = new Set();
    return;
  }
  aheadFeed = board;
  aheadIds = new Set(fresh);
}

export function readAhead() {
  return aheadFeed;
}

export function coveredBy(board) {
  if (!aheadIds.size) return true;
  const ids = new Set((board?.information || []).map((item) => item?.id).filter(Boolean));
  return [...aheadIds].every((id) => ids.has(id));
}

export function hideDiscoverItem(id) {
  if (id) hidden.add(id);
}

/** 退出登录时连模块级状态一起清：换个人登录后，上一个人的隐藏集合与记忆快照都不该留下。 */
export function forgetDiscover() {
  hidden.clear();
  memory = null;
  aheadFeed = null;
  aheadIds = new Set();
}

export function showDiscoverItem(id) {
  hidden.delete(id);
}

// 快照里只剩公开帖子。`requests` 仍是契约里的字段，恒为空数组，这里不读它。
export function revealDiscover(board) {
  return (Array.isArray(board?.information) ? board.information : []).filter((item) => item?.id && !hidden.has(item.id));
}

export function emptyFacets() {
  return { categories: [], topics: [] };
}

export function facetsOf(board) {
  const facets = board?.facets;
  if (!facets || typeof facets !== "object") return emptyFacets();
  return {
    categories: Array.isArray(facets.categories) ? facets.categories : [],
    topics: Array.isArray(facets.topics) ? facets.topics : [],
  };
}

export function paintDiscover(board) {
  return {
    information: revealDiscover(board),
    people: Array.isArray(board?.people) ? board.people : [],
    facets: facetsOf(board),
  };
}

export function applyDiscoverSelf(painted, self) {
  const dismissed = new Set(self?.dismissed || []);
  const starred = new Set(self?.starred || []);
  const liked = new Set(self?.liked || []);
  const friends = new Set(self?.friends || []);
  const mine = new Set(self?.mine || []);
  return {
    information: (painted?.information || [])
      .filter((item) => !dismissed.has(item.id))
      .map((item) => ({
        ...item,
        personal: true,
        starred: starred.has(item.id),
        liked: liked.has(item.id),
        friend: friends.has(item.id),
        mine: mine.has(item.id),
        canFriend: !mine.has(item.id),
      })),
    people: painted?.people || [],
    facets: facetsOf(painted),
  };
}

export function cardIsMine(item, user) {
  if (!user || !item) return false;
  if (item.personal === false) return false;
  if (item.mine === true) return true;
  return item.canFriend === false;
}

/**
 * 这条的商品是不是已经买过（或本来就是自己的）。
 * 帖子不带价，取附件不需要凭据，所以这里只给 Store 用。
 */
export function cardBought(item, user) {
  // 货架上的自己那一件：`store.mine` 由服务端按账号给出，比反推 canFriend 可靠。
  if (item?.store?.mine === true) return true;
  if (item?.store?.bought === true) return true;
  return cardIsMine(item, user);
}

async function readBoardPayload(url, init) {
  const res = await fetch(url, { credentials: "same-origin", ...init });
  const type = res.headers.get("content-type") || "";
  if (!res.ok || !type.includes("json")) {
    const error = new Error("no_board");
    error.code = "no_board";
    throw error;
  }
  const data = await res.json();
  // 快照里只有公开帖子。`requests` 字段仍在中枢契约里，恒为空数组，这里不读它。
  if (!Array.isArray(data?.information)) {
    const error = new Error("no_board");
    error.code = "no_board";
    throw error;
  }
  if (!Array.isArray(data.people)) data.people = [];
  return data;
}

/** 入口磁盘上那一份。浏览器 30 秒内可以直接用它。 */
export async function fetchDiscoverBoard() {
  const data = await readBoardPayload("/discover.json");
  rememberDiscover(data);
  // 留下这一份，下一次打开先画它。
  writeBoardCache(browserStorage(), data);
  return data;
}

/**
 * 实例自己那一份（`/api/web/board`）。入口磁盘上的副本由中枢按间隔取回，可能落后
 * 一个间隔；只有比出屏幕上这份旧了才走这里，所以它不会变成每次打开都多一次的往返。
 */
export async function fetchAuthoritativeBoard() {
  const data = await readBoardPayload("/api/web/board", { cache: "no-store" });
  rememberDiscover(data);
  writeBoardCache(browserStorage(), data);
  return data;
}

/**
 * 屏幕上这一份是不是比实例自己那份旧。
 *
 * 入口磁盘上的快照由中枢按间隔从实例取回，所以它可能晚一个间隔；实例在会话响应里
 * 带回自己的版本。版本是写下快照的时刻，同一个格式，比大小就是比新旧。
 * 任一边没有版本（快照关掉、接口没回话）时一律当「不旧」：没有依据就不要回源。
 */
export function boardIsBehind(painted, version) {
  const paintedAt = Date.parse(painted?.version || "");
  const latestAt = Date.parse(version || "");
  if (!Number.isFinite(paintedAt) || !Number.isFinite(latestAt)) return false;
  return latestAt > paintedAt;
}
