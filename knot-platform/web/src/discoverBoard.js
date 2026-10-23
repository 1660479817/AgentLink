import { browserStorage, writeBoardCache } from "./boardCache.js";
import { wishIsLive } from "./record.js";

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
  const known = new Set([...(memory?.information || []), ...(memory?.requests || [])].map((item) => item?.id).filter(Boolean));
  const fresh = [...(board.information || []), ...(board.requests || [])].map((item) => item?.id).filter((id) => id && !known.has(id));
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
  const ids = new Set([...(board?.information || []), ...(board?.requests || [])].map((item) => item?.id).filter(Boolean));
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

export function revealDiscover(board) {
  const now = Date.now();
  return {
    information: (Array.isArray(board?.information) ? board.information : []).filter((item) => item?.id && !hidden.has(item.id)),
    requests: (Array.isArray(board?.requests) ? board.requests : []).filter(
      (wish) => wish?.id && !hidden.has(wish.id) && wishIsLive(wish, now)
    ),
  };
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

export function paintDiscover(board, userId) {
  const visible = revealDiscover(board);
  return {
    information: visible.information,
    requests: visible.requests.map((wish) => ({
      ...wish,
      mine: Boolean(userId && wish.authorId === userId),
    })),
    people: Array.isArray(board?.people) ? board.people : [],
    facets: facetsOf(board),
  };
}

export function applyDiscoverSelf(painted, self) {
  const dismissed = new Set(self?.dismissed || []);
  const starred = new Set(self?.starred || []);
  const liked = new Set(self?.liked || []);
  const friends = new Set(self?.friends || []);
  const granted = new Set(self?.granted || []);
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
        granted: granted.has(item.id) || mine.has(item.id),
      })),
    requests: (painted?.requests || [])
      .filter((wish) => !dismissed.has(wish.id))
      .map((wish) => {
        const count = self?.wishes?.[wish.id];
        return {
          ...wish,
          responseCount: count ? Number(count.responseCount) || 0 : wish.responseCount,
        };
      }),
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
 * 这条是不是已经付过、或本来就是自己的（下载不再扣分）。
 * wish 记录里同时有 `granted` 与 `unlocked`（requests.js 自己算的那份），两个都认；
 * 缺字段时按「没付过」处理：顶多多弹一次确认，不会多扣。
 */
export function cardGranted(item, user) {
  if (cardIsMine(item, user)) return true;
  return item?.granted === true || item?.unlocked === true;
}

export async function fetchDiscoverBoard() {
  // 入口把这一份设成 30 秒内可直接用，交给浏览器缓存判断，不再每次强制校验。
  const res = await fetch("/discover.json", { credentials: "same-origin" });
  const type = res.headers.get("content-type") || "";
  if (!res.ok || !type.includes("json")) {
    const error = new Error("no_board");
    error.code = "no_board";
    throw error;
  }
  const data = await res.json();
  if (!Array.isArray(data?.information) || !Array.isArray(data?.requests)) {
    const error = new Error("no_board");
    error.code = "no_board";
    throw error;
  }
  if (!Array.isArray(data.people)) data.people = [];
  rememberDiscover(data);
  // 留下这一份，下一次打开先画它。
  writeBoardCache(browserStorage(), data);
  return data;
}
