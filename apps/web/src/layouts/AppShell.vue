<script setup>
import { nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import AppButton from "../components/AppButton.vue";
import LocaleSwitch from "../components/LocaleSwitch.vue";
import OutboxNotice from "../components/OutboxNotice.vue";
import RememberLoginCard from "../components/RememberLoginCard.vue";
import { downloadConsent } from "../download/consent.js";
import { BackIcon, BellIcon, ChatIcon, ClockIcon, FriendsIcon, SearchIcon, StarIcon, UserIcon } from "../icons/index.js";
import { t } from "../i18n/index.js";
import { listSponsors } from "../api.js";
import { hasDraft, runningEntry, startReleaseWatch } from "../release.js";
import { useNotificationStore } from "../stores/notifications";
import { useOutboxStore } from "../stores/outbox";
import { useSessionStore } from "../stores/session";

const router = useRouter();
const notifications = useNotificationStore();
const outbox = useOutboxStore();
const session = useSessionStore();
const updateReady = ref(false);
let releaseWatch = null;
const mark = t("app.name").slice(0, 1);
const HISTORY_KEY = "knot.search.history";
const searchOpen = ref(false);
const query = ref("");
const searchInput = ref(null);
const history = ref(readHistory());
const sponsors = ref([]);

function readHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((item) => typeof item === "string" && item.trim()).slice(0, 5) : [];
  } catch {
    return [];
  }
}

function remember(q) {
  const next = [q, ...readHistory().filter((item) => item !== q)].slice(0, 5);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  history.value = next;
}

async function openSearch() {
  history.value = readHistory();
  searchOpen.value = true;
  await nextTick();
  searchInput.value?.focus({ preventScroll: true });
}

function closeSearch() {
  searchOpen.value = false;
}

function search(text = query.value) {
  const q = String(text || "").trim();
  if (!q) return;
  query.value = q;
  remember(q);
  searchOpen.value = false;
  router.push({ name: "discover", query: { q } });
}

function internalHref(href) {
  return typeof href === "string" && href.startsWith("/") && !href.startsWith("//");
}

function sponsorMark(title) {
  const text = String(title || "").trim();
  return text ? text.slice(0, 1) : mark;
}

function brandHref() {
  return session.user ? "/discover" : "/";
}

function refreshBrand(event) {
  event.preventDefault();
  const target = brandHref();
  const clean = window.location.pathname === target && !window.location.search && !window.location.hash;
  if (clean) window.location.reload();
  else window.location.assign(target);
}

function linkAttrs(href) {
  if (internalHref(href)) return { to: href };
  return { href, target: "_blank", rel: "noopener noreferrer" };
}

function pageBlocked() {
  if (outbox.jobs.length) return true;
  if (downloadConsent.value) return true;
  return hasDraft(document);
}

function reloadPage() {
  window.location.reload();
}

watch(
  () => [outbox.jobs.map((job) => `${job.id}:${job.status}`).join(","), downloadConsent.value?.phase || ""],
  () => releaseWatch?.poke()
);

onMounted(() => {
  notifications.load();
  releaseWatch = startReleaseWatch({
    current: () => runningEntry(document),
    fetchText: async () => {
      const response = await fetch("/index.html", { cache: "no-store" });
      if (!response.ok) throw new Error("release");
      return response.text();
    },
    blocked: pageBlocked,
    reload: reloadPage,
    onPending: (show) => {
      updateReady.value = show;
    },
    document,
  });
  listSponsors()
    .then((data) => {
      sponsors.value = Array.isArray(data.sponsors) ? data.sponsors : [];
    })
    .catch(() => {
      sponsors.value = [];
    });
});

onUnmounted(() => {
  releaseWatch?.stop();
  releaseWatch = null;
});
</script>

<template>
  <div class="app-frame">
    <a href="#main-content" class="skip-link">{{ t("app.skipToContent") }}</a>
    <header class="site-header">
      <div class="header-bar">
        <a :href="brandHref()" class="brand" :aria-label="t('app.name')" @click="refreshBrand">
          <span class="brand-mark" aria-hidden="true">{{ mark }}</span>
        </a>
        <AppButton
          v-if="!searchOpen"
          variant="icon"
          :aria-label="t('nav.search')"
          @click="openSearch"
        >
          <SearchIcon class="nav-icon" weight="header" aria-hidden="true" />
        </AppButton>
        <form v-else class="header-search" @submit.prevent="search()">
          <AppButton variant="icon" plain :aria-label="t('search.back')" @click="closeSearch">
            <BackIcon class="nav-icon" weight="header" aria-hidden="true" />
          </AppButton>
          <label class="search-field">
            <SearchIcon class="header-search-icon" aria-hidden="true" />
            <input
              ref="searchInput"
              v-model="query"
              type="search"
              enterkeyhint="search"
              :placeholder="t('nav.searchPlaceholder')"
              :aria-label="t('nav.search')"
            />
          </label>
        </form>
        <div class="header-side header-side-end">
          <AppButton variant="icon" to="/wish" :aria-label="t('nav.wish')">
            <ChatIcon class="nav-icon" weight="header" aria-hidden="true" />
          </AppButton>
          <AppButton variant="icon" to="/notifications" :aria-label="t('nav.notifications')">
            <BellIcon class="nav-icon" weight="header" aria-hidden="true" />
            <span v-if="notifications.unread > 0" class="nav-badge">{{
              notifications.unread > 99 ? "99+" : notifications.unread
            }}</span>
          </AppButton>
          <div class="header-locale">
            <LocaleSwitch variant="menu" />
          </div>
          <AppButton
            variant="icon"
            :to="session.user ? '/mine' : '/'"
            class="header-account"
            :class="{ 'has-photo': Boolean(session.user?.avatarUrl) }"
            :aria-label="session.user ? t('nav.mine') : t('remember.guestAction')"
          >
            <img v-if="session.user?.avatarUrl" class="header-avatar" :src="session.user.avatarUrl" alt="" />
            <UserIcon v-else filled weight="header" class="nav-icon" aria-hidden="true" />
          </AppButton>
        </div>
      </div>
    </header>
    <div v-if="updateReady" class="release-note" role="status">
      <p>{{ t("release.ready") }}</p>
      <AppButton variant="secondary" @click="reloadPage">{{ t("release.reload") }}</AppButton>
    </div>
    <Teleport to="body">
      <button v-if="searchOpen" type="button" class="search-backdrop" :aria-label="t('search.back')" @click="closeSearch" />
      <div v-if="searchOpen && history.length" class="search-sheet">
        <div class="search-history">
          <p class="search-recent">{{ t("search.recent") }}</p>
          <ul>
            <li v-for="item in history" :key="item">
              <button type="button" @click="search(item)">
                <span class="history-mark" aria-hidden="true">
                  <ClockIcon class="nav-icon" />
                </span>
                <span class="history-text">{{ item }}</span>
              </button>
            </li>
          </ul>
        </div>
      </div>
    </Teleport>
    <div class="stage" :class="{ 'has-sponsors': sponsors.length > 0 }">
      <nav class="rail rail-shortcuts" :aria-label="t('rail.shortcuts')">
        <div class="shortcut-list">
          <RouterLink
            :to="session.user ? { name: 'mine' } : { name: 'gate' }"
            class="shortcut"
            :active-class="session.user ? 'router-link-active' : ''"
          >
            <UserIcon class="shortcut-icon" aria-hidden="true" />
            <span class="shortcut-label">{{ t("nav.mine") }}</span>
          </RouterLink>
          <RouterLink :to="{ name: 'stars' }" class="shortcut">
            <StarIcon class="shortcut-icon" aria-hidden="true" />
            <span class="shortcut-label">{{ t("rail.stars") }}</span>
          </RouterLink>
          <RouterLink :to="{ name: 'friends' }" class="shortcut">
            <FriendsIcon class="shortcut-icon" aria-hidden="true" />
            <span class="shortcut-label">{{ t("rail.friends") }}</span>
          </RouterLink>
        </div>
        <div class="rail-locale">
          <LocaleSwitch variant="field" />
        </div>
      </nav>
      <main id="main-content" class="layout">
        <RememberLoginCard />
        <OutboxNotice />
        <slot />
      </main>
      <aside v-if="sponsors.length" class="rail rail-sponsor" :aria-label="t('rail.sponsored')">
        <p class="rail-label">{{ t("rail.sponsored") }}</p>
        <div class="sponsor-list">
          <component
            :is="internalHref(item.href) ? 'RouterLink' : 'a'"
            v-for="item in sponsors"
            :key="item.id"
            class="sponsor-card"
            v-bind="linkAttrs(item.href)"
          >
            <span class="sponsor-media" aria-hidden="true">
              <img v-if="item.image" class="sponsor-photo" :src="item.image" alt="" />
              <span v-else class="brand-mark">{{ sponsorMark(item.title) }}</span>
            </span>
            <span class="sponsor-copy">
              <span class="sponsor-title">{{ item.title }}</span>
              <span v-if="item.caption" class="sponsor-caption">{{ item.caption }}</span>
              <span v-if="item.source" class="sponsor-source">{{ item.source }}</span>
              <span class="sponsor-meta">{{ t("rail.sponsorMeta") }}</span>
            </span>
          </component>
        </div>
      </aside>
    </div>
  </div>
</template>
