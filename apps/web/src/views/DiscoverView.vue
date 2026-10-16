<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import AppButton from "../components/AppButton.vue";
import InformationCard from "../components/InformationCard.vue";
import ShareComposer from "../components/ShareComposer.vue";
import SnapComposer from "../components/SnapComposer.vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { addCardFriend, discoverSelf, dismissInformation, downloadInformation, downloadShare, listInformation, listRequests, removeCardFriend, searchInformation, starInformation, unstarInformation } from "../api.js";
import { applyDiscoverSelf, cardIsMine, coveredBy, fetchDiscoverBoard, hideDiscoverItem, paintDiscover, readAhead, readDiscoverMemory, rememberAhead, revealDiscover, showDiscoverItem } from "../discoverBoard.js";
import { nameMark } from "../composers/packet.js";
import { acceptDownload } from "../download/consent.js";
import { feeOf, priceOf } from "../record.js";
import { t } from "../i18n/index.js";
import { BackIcon, PlusIcon, UserIcon } from "../icons/index.js";
import { useFriendStore } from "../stores/friends";
import { useOutboxStore } from "../stores/outbox";
import { useNotificationStore } from "../stores/notifications";
import { useSessionStore } from "../stores/session";

const session = useSessionStore();
const pending = readAhead();
const opening = pending
  ? { information: pending.information || [], requests: pending.requests || [] }
  : paintDiscover(readDiscoverMemory(), session.user?.id);
const items = ref(opening.information);
const wishes = ref(opening.requests);
const feedReady = ref(opening.information.length > 0 || opening.requests.length > 0);
const cursor = ref(null);
const loadingMore = ref(false);
const moreAvailable = ref(false);
const feedEnd = ref(null);
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
const filterAuthor = ref(null);
const filterLabel = computed(() => filterAuthor.value?.name || t("home.author"));
const createMark = computed(() => nameMark(session.user));

let railObserver = null;
let railDrag = null;

onMounted(() => {
  load();
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
  endRailDrag();
});
watch([searchQ, authorQ], () => {
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
watch(wishes, async () => {
  await nextTick();
  updateRail();
});

function showPainted(painted) {
  items.value = painted.information;
  wishes.value = painted.requests;
  feedReady.value = true;
  cursor.value = painted.information.length ? painted.information[painted.information.length - 1].id : null;
  moreAvailable.value = painted.information.length > 0;
}

async function loadMore() {
  if (loadingMore.value || !moreAvailable.value || searchQ.value) return;
  loadingMore.value = true;
  try {
    const data = await listInformation(authorQ.value || null, cursor.value || null);
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

async function patchSelf(painted) {
  if (!session.user) return painted;
  const ids = [...painted.information, ...painted.requests].map((item) => item.id);
  try {
    return applyDiscoverSelf(painted, await discoverSelf(ids));
  } catch {
    return painted;
  }
}

async function loadLive(options = {}) {
  const q = searchQ.value;
  const author = authorQ.value;
  const [info, wish] = await Promise.all([
    q ? searchInformation(q) : listInformation(author),
    listRequests(),
  ]);
  filterAuthor.value = author ? info.author || null : null;
  const painted = { information: info.information || [], requests: wish.requests || [] };
  if (options.ahead) rememberAhead(painted);
  showPainted(painted);
}

async function loadBoard() {
  const board = await fetchDiscoverBoard();
  if (readAhead() && !coveredBy(board)) {
    showPainted(await patchSelf(revealDiscover(readAhead())));
    return;
  }
  if (readAhead()) rememberAhead(null);
  const painted = await patchSelf(paintDiscover(board, session.user?.id));
  showPainted(painted);
}

async function load(options = {}) {
  const live = options.live === true || Boolean(searchQ.value) || Boolean(authorQ.value);
  try {
    if (live) await loadLive({ ahead: options.live === true && !searchQ.value && !authorQ.value });
    else await loadBoard();
  } catch {
    if (searchQ.value) {
      items.value = [];
      wishes.value = [];
      feedReady.value = true;
      cursor.value = null;
      moreAvailable.value = false;
      return;
    }
    if (authorQ.value) {
      items.value = [];
      feedReady.value = true;
      cursor.value = null;
      moreAvailable.value = false;
      return;
    }
    if (!live && (readAhead() || readDiscoverMemory())) return;
    if (!live) {
      try {
        await loadLive();
        return;
      } catch {
        /* the feed stays empty below */
      }
    }
    if (!items.value.length) {
      items.value = [];
      wishes.value = [];
      cursor.value = null;
      moreAvailable.value = false;
    }
    feedReady.value = true;
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

function wishText(wish) {
  const body = String(wish.body || "").trim();
  if (body) return body;
  const file = [...(wish.images || []), ...(wish.audio || []), ...(wish.attachments || [])][0];
  return file?.name || file?.url || t("nav.wish");
}

function wishTo(wish) {
  return wish.mine
    ? { name: "wish", query: { wish: wish.id } }
    : { name: "wish", query: { respond: wish.id } };
}

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

function clearSearch() {
  router.push({ name: "discover", query: {} });
}

function clearAuthor() {
  filterAuthor.value = null;
  router.push({ name: "discover", query: {} });
}

function filterByAuthor(item) {
  const id = item?.author?.id;
  if (!id) return;
  if (authorQ.value === id) {
    clearAuthor();
    return;
  }
  filterAuthor.value = {
    id,
    name: item.author?.name || "",
    avatarUrl: item.author?.avatarUrl || "",
  };
  router.push({ name: "discover", query: { author: id } });
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

async function shareItem(item) {
  if (item.sharing) return;
  item.sharing = true;
  item.shareError = "";
  try {
    await downloadShare(item.id);
  } catch {
    item.shareError = t("error.request_failed");
  } finally {
    item.sharing = false;
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
      const data = searchQ.value ? await searchInformation(searchQ.value) : await listInformation(authorQ.value);
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
  <section v-if="searchQ" class="card search-context">
    <p class="search-context-label">{{ t("home.searchResults", { q: searchQ }) }}</p>
    <AppButton variant="secondary" @click="clearSearch">{{ t("home.clearSearch") }}</AppButton>
  </section>

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
      <RouterLink v-for="wish in wishes" :key="wish.id" class="intel-bounty" :to="wishTo(wish)">
        <span class="intel-bounty-body">
          <span class="intel-bounty-text">{{ wishText(wish) }}</span>
        </span>
        <span class="intel-bounty-reward">
          {{ wish.mine && wish.responseCount != null ? t("home.wishReplyCount", { n: wish.responseCount || 0 }) : t("nav.wish") }}
        </span>
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

  <section v-if="authorQ" class="card feed-filter">
    <div class="feed-filter-who">
      <span class="information-avatar" aria-hidden="true">
        <img v-if="filterAuthor?.avatarUrl" :src="filterAuthor.avatarUrl" alt="" />
        <UserIcon v-else />
      </span>
      <p class="feed-filter-name">{{ filterLabel }}</p>
    </div>
    <AppButton variant="secondary" @click="clearAuthor">{{ t("home.showAll") }}</AppButton>
  </section>

  <div v-if="!feedReady" class="card feed-skeleton" role="status" :aria-label="t('app.loading')" />
  <div v-if="!feedReady" class="card feed-skeleton" aria-hidden="true" />

  <InformationCard
    v-for="item in items"
    :key="item.id"
    :body="item.body || ''"
    :category="item.kMeta?.category || ''"
    :language="item.kMeta?.language || ''"
    :price="priceOf(item)"
    :granted="item.granted !== false"
    :image-urls="item.imageUrls || item.images?.map((file) => file.url).filter(Boolean) || []"
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
    :starred="Boolean(item.starred)"
    :can-star="Boolean(session.user)"
    :friend="Boolean(item.friend)"
    :can-friend="Boolean(item.canFriend)"
    :busy="Boolean(item.downloading) || (Boolean(session.user) && item.personal === false)"
    :sharing="Boolean(item.sharing)"
    :notice="item.shareError || ''"
    @author="filterByAuthor(item)"
    @dismiss="dismissItem(item)"
    @star="toggleStar(item)"
    @friend="toggleFriend(item)"
    @download="downloadItem(item)"
    @share="shareItem(item)"
  />
  <p v-if="feedReady && items.length === 0" class="muted feed-empty">
    {{ searchQ ? t("home.searchEmpty") : authorQ ? t("home.filterEmpty") : t("home.empty") }}
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
