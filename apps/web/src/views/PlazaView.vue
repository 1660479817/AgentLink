<script setup>
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import CardTile from "../components/CardTile.vue";
import SnapshotRefreshButton from "../components/SnapshotRefreshButton.vue";
import { SearchIcon, UploadIcon } from "../icons/index.js";
import { exchangeIntent, fetchWebSnapshot, submitDemand } from "../api.js";
import { t } from "../i18n/index.js";
import { setLastPlazaQuery } from "../infoBufferPool.js";
import { useInfoBufferStore } from "../stores/infoBuffer";
import { useSessionStore } from "../stores/session";

const route = useRoute();
const router = useRouter();
const session = useSessionStore();
const buffer = useInfoBufferStore();

const plaza = computed(() => buffer.surfaces.plaza);
const q = ref(route.query.q?.toString() || "");
const moreCards = ref([]);
const nextCursor = ref(null);
const loadingMore = ref(false);
const demandBody = ref("");
const demandSent = ref(false);
const exchangeMsg = ref("");
const searchError = ref("");

const firstPage = computed(() => plaza.value?.cards ?? []);
const bufferCursor = computed(() => plaza.value?.pagination?.nextCursor ?? null);

const displayCards = computed(() => {
  const seen = new Set();
  const out = [];
  for (const c of [...firstPage.value, ...moreCards.value]) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
});

const canLoadMore = computed(() => Boolean(nextCursor.value ?? bufferCursor.value));

watch(
  () => route.query.q,
  (v) => {
    q.value = v?.toString() || "";
    moreCards.value = [];
  }
);

watch(bufferCursor, (c) => {
  nextCursor.value = c;
});

let debounceTimer;
watch(q, (val) => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    const next = val.trim();
    const urlQ = route.query.q?.toString() || "";
    if (next !== urlQ) {
      await router.replace({ query: next ? { q: next } : {} });
    }
    setLastPlazaQuery({ q: next, cursor: null });
    searchError.value = "";
    try {
      await buffer.pull({ surfaces: ["plaza"], plaza: { q: next } }, { force: true });
    } catch (e) {
      searchError.value = e.code || e.message;
    }
  }, 350);
});

async function onLoadMore() {
  const cursor = nextCursor.value ?? bufferCursor.value;
  if (!cursor || loadingMore.value) return;
  loadingMore.value = true;
  searchError.value = "";
  try {
    const data = await fetchWebSnapshot({
      surfaces: ["plaza"],
      plaza: { q: q.value.trim(), cursor, limit: 20 },
    });
    const page = data.surfaces?.plaza;
    moreCards.value.push(...(page?.cards ?? []));
    nextCursor.value = page?.pagination?.nextCursor ?? null;
  } catch (e) {
    searchError.value = e.code || e.message;
  } finally {
    loadingMore.value = false;
  }
}

async function onExchange(cardId) {
  exchangeMsg.value = "";
  if (!session.user) {
    router.push({ name: "login", query: { redirect: "/plaza", reason: "REGISTER_REQUIRED" } });
    return;
  }
  try {
    await exchangeIntent(cardId);
  } catch (e) {
    if (e.code === "REGISTER_REQUIRED") {
      router.push({ name: "login", query: { reason: "REGISTER_REQUIRED" } });
      return;
    }
    exchangeMsg.value = e.code === "NOT_IMPLEMENTED" ? t("plaza.exchangeNotReady") : e.message;
  }
}

async function onDemand() {
  searchError.value = "";
  try {
    await submitDemand(demandBody.value);
    demandBody.value = "";
    demandSent.value = true;
  } catch (err) {
    searchError.value = err.code || err.message;
  }
}
</script>

<template>
  <div class="card plaza-hero">
    <p class="chip">{{ t("plaza.tagline") }}</p>
    <div class="plaza-toolbar">
      <h2 class="page-title" style="margin: 0">{{ t("plaza.title") }}</h2>
      <SnapshotRefreshButton :surfaces="['plaza']" :plaza="{ q: q.trim() }" />
    </div>
    <p class="muted">
      {{ t("plaza.intro") }}
      <RouterLink to="/login">{{ t("plaza.loginLink") }}</RouterLink>。
    </p>
    <RouterLink
      v-if="session.user"
      :to="{ name: 'mine-publish' }"
      class="button-link secondary"
      style="margin-bottom: 0.75rem"
    >
      <UploadIcon class="nav-icon" aria-hidden="true" />
      {{ t("plaza.provideInfo") }}
    </RouterLink>
    <label class="search-field">
      <SearchIcon class="search-field-icon" aria-hidden="true" />
      <input
        v-model="q"
        type="search"
        name="q"
        :placeholder="t('plaza.searchPlaceholder')"
        :aria-label="t('plaza.searchLabel')"
      />
    </label>
    <div class="status-live" aria-live="polite">
      <p v-if="buffer.status === 'loading' && displayCards.length === 0" class="muted">
        {{ t("plaza.loading") }}
      </p>
    </div>
  </div>

  <p v-if="searchError || buffer.lastError" class="error" role="alert">
    {{ searchError || buffer.lastError }}
  </p>
  <p v-if="exchangeMsg" class="muted" aria-live="polite">{{ exchangeMsg }}</p>

  <div class="grid-cards">
    <p v-if="displayCards.length === 0" class="muted">{{ t("plaza.empty") }}</p>
    <CardTile v-for="c in displayCards" :key="c.id" :card="c" @exchange="onExchange" />
  </div>

  <div v-if="canLoadMore" style="text-align: center; margin: 1rem 0">
    <button type="button" class="secondary" :disabled="loadingMore" @click="onLoadMore">
      {{ loadingMore ? t("plaza.loadingMore") : t("plaza.loadMore") }}
    </button>
  </div>

  <div class="card" style="margin-top: 1.5rem">
    <p class="section-head">{{ t("plaza.demandTitle") }}</p>
    <p class="muted">{{ t("plaza.demandIntro") }}</p>
    <form @submit.prevent="onDemand">
      <label for="demand-body">{{ t("plaza.demandLabel") }}</label>
      <textarea
        id="demand-body"
        v-model="demandBody"
        name="demand"
        :placeholder="t('plaza.demandPlaceholder')"
        rows="4"
        style="width: 100%; box-sizing: border-box; margin-bottom: 8px"
        required
      />
      <button type="submit">{{ t("plaza.demandSubmit") }}</button>
    </form>
    <p v-if="demandSent" class="muted" aria-live="polite">{{ t("plaza.demandSent") }}</p>
  </div>
</template>
