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
  const friends = new Set(self?.friends || []);
  const granted = new Set(self?.granted || []);
  const mine = new Set(self?.mine || []);
  const audio = self?.audio || {};
  return {
    information: (painted?.information || [])
      .filter((item) => !dismissed.has(item.id))
      .map((item) => ({
        ...item,
        personal: true,
        starred: starred.has(item.id),
        friend: friends.has(item.id),
        mine: mine.has(item.id),
        canFriend: !mine.has(item.id),
        granted: granted.has(item.id) || mine.has(item.id),
        audio: audio[item.id] || item.audio,
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

export async function fetchDiscoverBoard() {
  const res = await fetch("/discover.json", { cache: "no-cache", credentials: "same-origin" });
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
  return data;
}
