<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import AppButton from "../components/AppButton.vue";
import InformationCard from "../components/InformationCard.vue";
import ActorMark from "../components/ActorMark.vue";
import ShareComposer from "../components/ShareComposer.vue";
import SnapComposer from "../components/SnapComposer.vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { addCardFriend, closeInformation, discoverSelf, dismissInformation, downloadInformation, fetchFacets, getHome, getInformation, listInformation, listPeople, removeCardFriend, searchInformation, starInformation, unstarInformation } from "../api.js";
import FilterBar from "../components/FilterBar.vue";
import { browserStorage, readBoardCache } from "../boardCache.js";
import { applyDiscoverSelf, cardIsMine, coveredBy, fetchDiscoverBoard, hideDiscoverItem, paintDiscover, readAhead, readDiscoverMemory, rememberAhead, revealDiscover, showDiscoverItem } from "../discoverBoard.js";
import { errorText, nameMark } from "../composers/packet.js";
import { acceptDownload } from "../download/consent.js";
import { feeOf, priceOf } from "../record.js";
import { startPolling } from "../polling.js";
import { timeAgo } from "../time.js";
import { t } from "../i18n/index.js";
import { BackIcon, PlusIcon, UserIcon } from "../icons/index.js";
import { useFriendStore } from "../stores/friends";
import { useOutboxStore } from "../stores/outbox";
import { useNotificationStore } from "../stores/notifications";
import { useSessionStore } from "../stores/session";

const session = useSessionStore();
const pending = readAhead();
// 首帧优先用本机留下的那一份快照：刷新后不必等隧道就能画出来。
const cachedBoard = readDiscoverMemory() || readBoardCache(browserStorage());
const opening = pending
  ? { information: pending.information || [], requests: pending.requests || [], people: pending.people || [], facets: pending.facets || { categories: [], topics: [] } }
  : paintDiscover(cachedBoard, session.user?.id);
const items = ref(opening.information);
const people = ref(opening.people || []);
const facets = ref(opening.facets || { categories: [], topics: [] });
const feedReady = ref(opening.information.length > 0 || (opening.people || []).length > 0);
const cursor = ref(null);
const loadingMore = ref(false);
const moreAvailable = ref(false);
const feedEnd = ref(null);
// 检索被限流时不要把「稍等」画成「没有结果」：这两个空态对用户是两件不同的事。
const feedBusySeconds = ref(0);
let feedObserver = null;
const railViewport = ref(null);
const railCanPrev = ref(false);
const railCanNext = ref(false);
const surface = ref(null);
const shareFocus = ref({ kind: "text", n: 0 });
const notifications = useNotificationStore();
const friends = useFriendStore();
const outbox = useOutboxStore();
const route = useRoute();
const router = useRouter();
const searchQ = computed(() => String(route.query.q || "").trim());
const authorQ = computed(() => String(route.query.author || "").trim());
const categoryQ = computed(() => String(route.query.category || "").trim());
const topicQ = computed(() => String(route.query.topic || "").trim());
const postQ = computed(() => String(route.query.post || "").trim());
const filterAuthor = ref(null);
const activeFilters = computed(() => ({ category: categoryQ.value, topic: topicQ.value }));
const hasFilter = computed(() => Boolean(searchQ.value || authorQ.value || categoryQ.value || topicQ.value));
const createMark = computed(() => nameMark(session.user));

let railObserver = null;
let railDrag = null;
let feedPoll = null;
let refreshing = false;
// 公开快照已经带着 facets 时，首屏不再为它多走一次接口。
let facetsFromBoard = Boolean(cachedBoard?.facets);
const FEED_POLL_MS = 60 * 1000;

onMounted(() => {
  load().then(() => {
    focusPost();
    ensureFacets();
  });
  feedPoll = startPolling({
    fn: refreshFeed,
    intervalMs: FEED_POLL_MS,
    when: () => !searchQ.value,
  });
  const el = railViewport.value;
  if (el && typeof ResizeObserver !== "undefined") {
    railObserver = new ResizeObserver(() => updateRail());
    railObserver.observe(el);
  }
  if (typeof IntersectionObserver !== "undefined") {
    feedObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore();
      },
      { rootMargin: "400px 0px" }
    );
  }
});
onBeforeUnmount(() => {
  railObserver?.disconnect();
  feedObserver?.disconnect();
  feedObserver = null;
  feedPoll?.stop();
  feedPoll = null;
  endRailDrag();
});
watch([searchQ, authorQ, categoryQ, topicQ], () => {
  if (authorQ.value && filterAuthor.value?.id !== authorQ.value) filterAuthor.value = null;
  if (!authorQ.value) filterAuthor.value = null;
  load();
});
watch([feedReady, () => items.value.length], async () => {
  await nextTick();
  if (!feedObserver) return;
  feedObserver.disconnect();
  if (feedEnd.value && !searchQ.value) feedObserver.observe(feedEnd.value);
});
watch(people, async () => {
  await nextTick();
  updateRail();
});

function showPainted(painted) {
  items.value = painted.information;
  if (Array.isArray(painted.people)) people.value = painted.people;
  facets.value = painted.facets || { categories: [], topics: [] };
  feedReady.value = true;
  cursor.value = painted.information.length ? painted.information[painted.information.length - 1].id : null;
  moreAvailable.value = painted.information.length > 0;
}

async function focusPost() {
  let id = postQ.value;
  if (!id) return;
  if (!items.value.some((item) => item.id === id)) {
    try {
      const info = await getInformation(id);
      if (info && info.id) {
        items.value = [info, ...items.value.filter((row) => row.id !== info.id)];
        feedReady.value = true;
        // 旧地址会解到最新一版：把地址栏换成当前这条，复制出去的链接才不会又递出旧 id。
        if (info.id !== id) {
          id = info.id;
          router.replace({ query: { ...route.query, post: id } });
        }
      }
    } catch {
      /* 帖子可能已下架，保留当前信息流 */
    }
  }
  await nextTick();
  document.getElementById(`intel-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function loadMore() {
  if (loadingMore.value || !moreAvailable.value || searchQ.value) return;
  loadingMore.value = true;
  try {
    const data = await listInformation(authorQ.value || null, cursor.value || null, activeFilters.value);
    const incoming = Array.isArray(data.information) ? data.information : [];
    const seen = new Set(items.value.map((item) => item.id));
    const fresh = incoming.filter((row) => row?.id && !seen.has(row.id));
    if (fresh.length) {
      items.value = [...items.value, ...fresh];
      cursor.value = fresh[fresh.length - 1].id;
    }
    moreAvailable.value = incoming.length > 0;
  } catch {
    /* keep the button so the user can retry */
  } finally {
    loadingMore.value = false;
  }
}

// 把个人状态叠到已经在屏幕上的这一列。只看当前的 items，不覆盖刷新期间新加进来的帖子。
function applySelf(self) {
  if (!self || typeof self !== "object") return;
  items.value = applyDiscoverSelf({ information: items.value, requests: [] }, self).information;
}

// 会话与个人状态一次取回。首屏已经画了快照，所以这一条迟一点不影响页面出现。
let personalising = null;
function personalise() {
  if (personalising) return personalising;
  personalising = (async () => {
    try {
      if (!session.userKnown) {
        // 还不知道是谁：/home 把会话、Agent、未读数和快照上的个人状态一起带回来。
        const data = await getHome();
        session.applyHome(data);
        notifications.setUnread(data.unread);
        // 没有会话时不要叠：空状态会让本来该藏起来的操作（加好友等）显示出来。
        if (data.user) applySelf(data.self);
        return;
      }
      if (!session.user) return;
      const ids = items.value.map((item) => item.id);
      applySelf(await discoverSelf(ids));
    } catch {
      /* 隧道没通时保留公开快照那一屏，登录态等下一次刷新 */
    }
  })();
  return personalising.finally(() => {
    personalising = null;
  });
}

async function loadLive(options = {}) {
  const q = searchQ.value;
  const author = authorQ.value;
  // 公开快照关掉时用户条没有快照可画，首屏跟信息流一起取一次。
  // 两条请求互不依赖，一起发，少等一次往返。
  const [info, roster] = await Promise.all([
    q ? searchInformation(q, activeFilters.value) : listInformation(author, null, activeFilters.value),
    people.value.length ? Promise.resolve(null) : listPeople().catch(() => null),
  ]);
  if (Array.isArray(roster?.people)) people.value = roster.people;
  filterAuthor.value = author ? info.author || null : null;
  const painted = { information: info.information || [], requests: [], people: people.value, facets: facets.value };
  if (options.ahead) rememberAhead(painted);
  showPainted(painted);
}

async function loadBoard() {
  const board = await fetchDiscoverBoard();
  facetsFromBoard = Boolean(board.facets);
  if (readAhead() && !coveredBy(board)) {
    // 刚发布过：先把那一屏画出来，个人状态稍后再叠，不挡着首屏。
    // people 与 facets 沿用当前值，`/discover.json` 里那一份不一定包含刚发的这条。
    const ahead = revealDiscover(readAhead());
    showPainted({ information: ahead.information, requests: ahead.requests, people: people.value, facets: facets.value });
    void personalise();
    return;
  }
  if (readAhead()) rememberAhead(null);
  // 先画公开快照，不等任何一次跨境往返。
  showPainted(paintDiscover(board, session.user?.id));
  void personalise();
}

// 快照里带了 facets 就直接用。只有走实时接口、或快照没带这一项时，才回源取一次。
async function ensureFacets() {
  if (facetsFromBoard) return;
  try {
    const next = await fetchFacets();
    facets.value = next || { categories: [], topics: [] };
  } catch {
    /* 隧道断时沿用现有选项，或保持空 */
  }
}

async function load(options = {}) {
  // 公开快照关掉时直接走实时接口。
  const live = options.live === true || hasFilter.value || session.site.publicBoard === false;
  feedBusySeconds.value = 0;
  try {
    if (live) {
      await loadLive({ ahead: options.live === true && !hasFilter.value });
      // 走实时接口时首屏没有经过 loadBoard，会话与个人状态在这里补一次。
      void personalise();
    } else await loadBoard();
  } catch (error) {
    if (hasFilter.value) {
      // 429 不是「搜不到」：把还要等多久记下来，模板据此换一句话。
      if (searchQ.value && error?.status === 429) feedBusySeconds.value = Number(error.retryAfter) || 1;
      items.value = [];
      feedReady.value = true;
      cursor.value = null;
      moreAvailable.value = false;
      return;
    }
    // 本机已经有可画的一屏（刚发布的、或上一份快照）时，不要退回空信息流。
    if (!live && (readAhead() || readDiscoverMemory() || opening.information.length)) return;
    if (!live) {
      try {
        await loadLive();
        void personalise();
        return;
      } catch {
        /* the feed stays empty below */
      }
    }
    if (!items.value.length) {
      items.value = [];
      cursor.value = null;
      moreAvailable.value = false;
    }
    feedReady.value = true;
  }
}

async function refreshFeed() {
  if (refreshing || !feedReady.value || loadingMore.value || searchQ.value) return;
  // 首屏那一次 /home 没赶上（隧道抖了一下）时，在这里补：只补会话，不换信息流。
  if (!session.userKnown) void personalise();
  refreshing = true;
  try {
    const [info, roster] = await Promise.all([
      listInformation(authorQ.value || null, null, activeFilters.value),
      listPeople(),
    ]);
    const incoming = Array.isArray(info.information) ? info.information : [];
    const byId = new Map(items.value.map((item) => [item.id, item]));
    const fresh = [];
    for (const row of incoming) {
      if (!row?.id) continue;
      const existing = byId.get(row.id);
      if (existing) Object.assign(existing, row);
      else fresh.push(row);
    }
    if (Array.isArray(roster.people)) people.value = roster.people;
    filterAuthor.value = authorQ.value ? info.author || null : null;
    if (fresh.length && window.scrollY < 200) {
      items.value = [...fresh, ...items.value];
    }
  } catch {
    /* keep the current feed; the next round retries */
  } finally {
    refreshing = false;
  }
}

watch(
  () => friends.revision,
  () => {
    if (friends.revision) load();
  }
);
watch(
  () => outbox.revision,
  (revision) => {
    if (!revision) return;
    load({ live: true });
    notifications.load();
  }
);

function updateRail() {
  const el = railViewport.value;
  if (!el) {
    railCanPrev.value = false;
    railCanNext.value = false;
    return;
  }
  railCanPrev.value = el.scrollLeft > 4;
  railCanNext.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
}

function scrollRail(direction) {
  const el = railViewport.value;
  if (!el) return;
  const distance = Math.max(el.clientWidth * 0.8, 136);
  el.scrollBy({ left: direction * distance, behavior: "smooth" });
}

function endRailDrag() {
  railDrag = null;
  railViewport.value?.classList.remove("is-dragging");
  window.removeEventListener("pointermove", onRailPointerMove);
  window.removeEventListener("pointerup", onRailPointerUp);
  window.removeEventListener("pointercancel", onRailPointerUp);
}

function onRailPointerDown(event) {
  if (event.pointerType !== "mouse" || event.button !== 0) return;
  const el = railViewport.value;
  if (!el || el.scrollWidth <= el.clientWidth + 1) return;
  railDrag = { id: event.pointerId, x: event.clientX, left: el.scrollLeft, moved: false };
  window.addEventListener("pointermove", onRailPointerMove);
  window.addEventListener("pointerup", onRailPointerUp);
  window.addEventListener("pointercancel", onRailPointerUp);
}

function onRailPointerMove(event) {
  if (!railDrag || event.pointerId !== railDrag.id) return;
  const dx = event.clientX - railDrag.x;
  if (!railDrag.moved && Math.abs(dx) < 8) return;
  const el = railViewport.value;
  if (!el) return;
  if (!railDrag.moved) {
    railDrag.moved = true;
    el.classList.add("is-dragging");
  }
  el.scrollLeft = railDrag.left - dx;
}

function onRailPointerUp(event) {
  if (!railDrag || event.pointerId !== railDrag.id) return;
  const moved = railDrag.moved;
  endRailDrag();
  if (!moved) return;
  const el = railViewport.value;
  const stopClick = (clickEvent) => {
    clickEvent.preventDefault();
    clickEvent.stopPropagation();
    el?.removeEventListener("click", stopClick, true);
  };
  el?.addEventListener("click", stopClick, true);
}

function clearAllFilters() {
  filterAuthor.value = null;
  router.push({ name: "discover", query: {} });
}

function clearFilterKey(key) {
  if (key === "author") filterAuthor.value = null;
  const query = { ...route.query };
  delete query[key];
  router.push({ name: "discover", query });
}

function selectFilter(key, value) {
  const query = { ...route.query };
  query[key] = value;
  router.push({ name: "discover", query });
}

// 卡片上是人还是 Agent，读屏时也要说清：链接带了 aria-label，里面那个徽标念不出来。
function personLabel(person) {
  const name = person?.name || t("home.author");
  return t(person?.role === "agent" ? "home.personCardAgent" : "home.personCard", { name });
}

function filterByAuthor(item) {
  const id = item?.author?.id;
  if (!id) return;
  if (authorQ.value === id) {
    clearFilterKey("author");
    return;
  }
  filterAuthor.value = {
    id,
    name: item.author?.name || "",
    avatarUrl: item.author?.avatarUrl || "",
    // 作者条上已经有这个人（或这个 Agent）的 role，先拿来画徽标，不等 `?author=` 回来。
    role: people.value.find((row) => row.id === id)?.role || "",
  };
  selectFilter("author", id);
}

function filterByCategory(item) {
  const category = String(item?.kMeta?.category || "").trim();
  if (!category) return;
  if (categoryQ.value === category) {
    clearFilterKey("category");
    return;
  }
  selectFilter("category", category);
}

function filterByTopic(topic) {
  const value = String(topic || "").trim();
  if (!value) return;
  if (topicQ.value === value) {
    clearFilterKey("topic");
    return;
  }
  selectFilter("topic", value);
}

function openSnap() {
  surface.value = surface.value === "snap" ? null : "snap";
}

function openShare(kind) {
  surface.value = "share";
  shareFocus.value = { kind, n: shareFocus.value.n + 1 };
}

function closeSurface() {
  surface.value = null;
}

function afterPost() {
  closeSurface();
}

async function dismissItem(item) {
  const previous = items.value;
  hideDiscoverItem(item.id);
  items.value = items.value.filter((row) => row.id !== item.id);
  try {
    await dismissInformation(item.id);
  } catch (error) {
    if (error.status !== 401) {
      showDiscoverItem(item.id);
      items.value = previous;
    }
  }
}

async function closeItem(item) {
  if (!session.user?.admin || item.closing) return;
  item.closing = true;
  item.closeError = "";
  const previous = items.value;
  try {
    await closeInformation(item.id);
    hideDiscoverItem(item.id);
    items.value = items.value.filter((row) => row.id !== item.id);
  } catch (error) {
    item.closeError = errorText(error.code, session.policy);
  } finally {
    item.closing = false;
  }
}

async function toggleStar(item) {
  if (!session.user) return;
  const previous = Boolean(item.starred);
  item.starred = !previous;
  try {
    if (item.starred) await starInformation(item.id);
    else await unstarInformation(item.id);
  } catch {
    item.starred = previous;
  }
}

async function toggleFriend(item) {
  if (!session.user || !item.canFriend) return;
  const previous = Boolean(item.friend);
  item.friend = !previous;
  try {
    const data = item.friend ? await addCardFriend(item.id) : await removeCardFriend(item.id);
    item.friend = Boolean(data.friend);
    await friends.load();
  } catch {
    item.friend = previous;
  }
}

async function downloadItem(item) {
  if (item.downloading) return;
  item.downloading = true;
  try {
    if (session.user) await session.load();
    const ok = await acceptDownload({
      price: priceOf(item),
      fee: feeOf(item),
      granted: item.granted === true,
      mine: cardIsMine(item, session.user),
      balance: session.user?.pointsBalance,
      code: session.user ? "" : "no_session",
      task: () => downloadInformation(item.id),
    });
    if (!ok) return;
    try {
      const data = searchQ.value ? await searchInformation(searchQ.value, activeFilters.value) : await listInformation(authorQ.value, null, activeFilters.value);
      const next = (data.information || []).find((row) => row.id === item.id);
      if (next) Object.assign(item, next);
      else item.granted = true;
      if (session.user) await session.load();
    } catch {
      item.granted = true;
    }
  } finally {
    item.downloading = false;
  }
}
</script>

<template>
  <ShareComposer
    v-if="!searchQ"
    :active="surface === 'share'"
    :focus-kind="shareFocus.kind"
    :focus-nonce="shareFocus.n"
    @activate="openShare"
    @close="closeSurface"
    @done="afterPost"
  />

  <section class="card intel-rail" :aria-label="t('home.storyRail')">
    <div ref="railViewport" class="intel-rail-viewport" @scroll="updateRail" @pointerdown="onRailPointerDown">
      <button type="button" class="intel-create" :aria-pressed="surface === 'snap'" @click="openSnap">
        <span class="intel-create-photo" aria-hidden="true">
          <img v-if="session.user?.avatarUrl" :src="session.user.avatarUrl" alt="" />
          <span v-else-if="createMark">{{ createMark }}</span>
          <UserIcon v-else />
        </span>
        <span class="intel-create-plus" aria-hidden="true">
          <PlusIcon />
        </span>
        <span class="intel-create-label">{{ t("home.storyCreate") }}</span>
      </button>
      <RouterLink
        v-for="person in people"
        :key="person.id"
        class="intel-person"
        :to="{ name: 'discover', query: { author: person.id } }"
        :aria-label="personLabel(person)"
      >
        <span class="intel-person-avatar" aria-hidden="true">
          <img v-if="person.avatarUrl" :src="person.avatarUrl" alt="" />
          <UserIcon v-else />
        </span>
        <span class="intel-person-label">
          <ActorMark class="intel-person-mark" :role="person.role" />
          <span class="intel-person-name">{{ person.name || t("home.author") }}</span>
        </span>
        <span v-if="timeAgo(person.lastAt)" class="intel-person-time">{{ timeAgo(person.lastAt) }}</span>
      </RouterLink>
    </div>
    <button
      v-if="railCanPrev"
      type="button"
      class="intel-rail-arrow intel-rail-arrow-prev"
      :aria-label="t('home.storyPrev')"
      @click="scrollRail(-1)"
    >
      <BackIcon aria-hidden="true" />
    </button>
    <button
      v-if="railCanNext"
      type="button"
      class="intel-rail-arrow intel-rail-arrow-next"
      :aria-label="t('home.storyNext')"
      @click="scrollRail(1)"
    >
      <BackIcon class="intel-rail-arrow-forward" aria-hidden="true" />
    </button>
  </section>

  <SnapComposer v-if="surface === 'snap'" @close="closeSurface" @done="afterPost" />

  <FilterBar
    :query="searchQ"
    :author="filterAuthor"
    :category="categoryQ"
    :topic="topicQ"
    :categories="facets.categories"
    :topics="facets.topics"
    @clear="clearAllFilters"
    @clear-key="clearFilterKey"
    @select="selectFilter"
  />

  <div v-if="!feedReady" class="card feed-skeleton" role="status" :aria-label="t('app.loading')" />
  <div v-if="!feedReady" class="card feed-skeleton" aria-hidden="true" />

  <InformationCard
    v-for="item in items"
    :key="item.id"
    :id="`intel-${item.id}`"
    :post-id="item.id"
    :body="item.body || ''"
    :category="item.kMeta?.category || ''"
    :topics="item.kMeta?.topics || []"
    :category-selected="categoryQ === (item.kMeta?.category || '')"
    :active-topic="topicQ"
    :language="item.kMeta?.language || ''"
    :price="priceOf(item)"
    :tip-total="Number(item.tipTotal) || 0"
    :granted="item.granted !== false"
    :images="item.images || []"
    :audio="item.audio || []"
    :videos="item.videos || []"
    :attachments="item.attachments || []"
    :note="item.kMeta?.note || ''"
    :verdict="item.kMeta?.verdict || ''"
    :author-id="item.author?.id || ''"
    :author-name="item.author?.name || ''"
    :avatar-url="item.author?.avatarUrl || ''"
    :author-selected="authorQ === item.author?.id"
    :actor="item.actor || ''"
    :created-at="item.kMeta?.createdAt || ''"
    :kind="item.kMeta?.kind || ''"
    :expires-at="item.kMeta?.expiresAt || ''"
    :mine="cardIsMine(item, session.user)"
    :starred="Boolean(item.starred)"
    :can-star="Boolean(session.user)"
    :friend="Boolean(item.friend)"
    :can-friend="Boolean(item.canFriend)"
    :busy="Boolean(item.downloading) || (Boolean(session.user) && item.personal === false)"
    :notice="item.closeError || ''"
    :can-close="Boolean(session.user?.admin)"
    :closing="Boolean(item.closing)"
    @author="filterByAuthor(item)"
    @category="filterByCategory(item)"
    @topic="filterByTopic"
    @dismiss="dismissItem(item)"
    @star="toggleStar(item)"
    @friend="toggleFriend(item)"
    @download="downloadItem(item)"
    @close="closeItem(item)"
  />
  <p v-if="feedReady && items.length === 0" class="muted feed-empty">
    {{ feedBusySeconds ? t("home.searchTooFast", { seconds: feedBusySeconds }) : searchQ ? t("home.searchEmpty") : hasFilter ? t("home.filterEmpty") : t("home.empty") }}
  </p>
  <div v-else-if="feedReady && !searchQ" class="feed-more">
    <div ref="feedEnd" class="feed-end" aria-hidden="true"></div>
    <AppButton
      v-if="moreAvailable"
      variant="secondary"
      :disabled="loadingMore"
      @click="loadMore"
    >
      {{ loadingMore ? t("home.loadingMore") : t("home.loadMore") }}
    </AppButton>
    <p v-else class="muted feed-end-note">{{ t("home.noMore") }}</p>
  </div>
</template>
