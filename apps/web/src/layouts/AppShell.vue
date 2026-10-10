<script setup>
import { nextTick, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import AppButton from "../components/AppButton.vue";
import { BackIcon, HistoryIcon, MessageIcon, SearchIcon, UserIcon, ZapIcon } from "../icons/index.js";
import { t } from "../i18n/index.js";
import { useMessageStore } from "../stores/messages";
import { useNotificationStore } from "../stores/notifications";

const router = useRouter();
const messages = useMessageStore();
const notifications = useNotificationStore();
const mark = t("app.name").slice(0, 1);
const HISTORY_KEY = "knot.search.history";
const searchOpen = ref(false);
const query = ref("");
const searchInput = ref(null);
const history = ref(readHistory());

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
  router.push({ name: "home", query: { q } });
}

onMounted(() => {
  messages.load();
  notifications.load();
});
</script>

<template>
  <div class="app-frame">
    <a href="#main-content" class="skip-link">{{ t("app.skipToContent") }}</a>
    <header class="site-header">
      <div class="header-bar">
        <RouterLink to="/" class="brand" :aria-label="t('nav.home')">
          <span class="brand-mark" aria-hidden="true">{{ mark }}</span>
        </RouterLink>
        <AppButton
          v-if="!searchOpen"
          variant="icon"
          :aria-label="t('nav.search')"
          @click="openSearch"
        >
          <SearchIcon class="nav-icon" aria-hidden="true" />
        </AppButton>
        <form v-else class="header-search" @submit.prevent="search()">
          <AppButton variant="icon" plain :aria-label="t('search.back')" @click="closeSearch">
            <BackIcon class="nav-icon" aria-hidden="true" />
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
          <AppButton variant="icon" to="/notifications" :aria-label="t('nav.notifications')">
            <ZapIcon class="nav-icon nav-icon-zap" aria-hidden="true" />
            <span v-if="notifications.unread > 0" class="nav-badge">{{
              notifications.unread > 99 ? "99+" : notifications.unread
            }}</span>
          </AppButton>
          <AppButton variant="icon" to="/messages" :aria-label="t('nav.messages')">
            <MessageIcon class="nav-icon" aria-hidden="true" />
            <span v-if="messages.unread > 0" class="nav-badge">{{ messages.unread > 99 ? "99+" : messages.unread }}</span>
          </AppButton>
          <AppButton variant="icon" to="/mine" :aria-label="t('nav.mine')">
            <UserIcon class="nav-icon" aria-hidden="true" />
          </AppButton>
        </div>
      </div>
    </header>
    <Teleport to="body">
      <button v-if="searchOpen" type="button" class="search-backdrop" :aria-label="t('search.back')" @click="closeSearch" />
      <div v-if="searchOpen && history.length" class="search-sheet">
        <div class="search-history">
          <p class="search-recent">{{ t("search.recent") }}</p>
          <ul>
            <li v-for="item in history" :key="item">
              <button type="button" @click="search(item)">
                <span class="history-mark" aria-hidden="true">
                  <HistoryIcon class="nav-icon" />
                </span>
                <span class="history-text">{{ item }}</span>
              </button>
            </li>
          </ul>
        </div>
      </div>
    </Teleport>
    <main id="main-content" class="layout">
      <slot />
    </main>
  </div>
</template>
