<script setup>
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import EmptyState from "../components/EmptyState.vue";
import VisibilityBadge from "../components/VisibilityBadge.vue";
import { ExchangeIcon } from "../icons/index.js";
import { exchangeIntent, getCard } from "../api.js";
import { formatDateTime } from "../lib/format.js";
import { t } from "../i18n/index.js";
import { useSessionStore } from "../stores/session";

const props = defineProps({ id: { type: String, required: true } });
const route = useRoute();
const router = useRouter();
const session = useSessionStore();

const card = ref(null);
const error = ref("");
const loading = ref(true);
const exchangeMsg = ref("");

function mapCard(raw) {
  if (!raw) return null;
  return {
    id: raw.id,
    title: raw.title,
    summary: raw.summary,
    thumbUrl: raw.thumb_url ?? raw.thumbUrl,
    visibility: raw.visibility,
    createdAt: raw.created_at ?? raw.createdAt,
    payload: raw.payload,
  };
}

onMounted(async () => {
  loading.value = true;
  error.value = "";
  try {
    const d = await getCard(props.id);
    card.value = mapCard(d.card);
  } catch (e) {
    if (e.code === "REGISTER_REQUIRED") error.value = "REGISTER_REQUIRED";
    else error.value = e.code || e.message;
  } finally {
    loading.value = false;
  }
});

async function onExchange() {
  exchangeMsg.value = "";
  if (!session.user) {
    router.push({ name: "login", query: { redirect: route.fullPath } });
    return;
  }
  try {
    await exchangeIntent(props.id);
    exchangeMsg.value = t("card.exchangeSubmitted");
  } catch (e) {
    if (e.code === "REGISTER_REQUIRED") {
      router.push({ name: "login" });
      return;
    }
    exchangeMsg.value = e.code === "NOT_IMPLEMENTED" ? t("plaza.exchangeNotReady") : e.message;
  }
}

const payloadKeys = () =>
  card.value?.payload ? Object.keys(card.value.payload).filter(Boolean) : [];
</script>

<template>
  <p v-if="loading" class="muted">{{ t("card.loading") }}</p>
  <div v-else-if="error === 'REGISTER_REQUIRED'" class="card auth-panel">
    <p class="error">{{ t("card.loginRequired") }}</p>
    <RouterLink :to="{ name: 'login', query: { redirect: route.fullPath } }" class="button-link">
      {{ t("nav.login") }}
    </RouterLink>
  </div>
  <div v-else-if="error || !card" class="card">
    <EmptyState :title="t('card.notFound')" :hint="t('card.notFoundHint')" />
    <RouterLink to="/plaza">{{ t("card.backPlaza") }}</RouterLink>
  </div>
  <template v-else>
    <p class="breadcrumb muted">
      <RouterLink to="/plaza">{{ t("card.backPlaza") }}</RouterLink>
    </p>
    <article class="card detail-article">
      <div v-if="card.thumbUrl" class="media-frame">
        <img :src="card.thumbUrl" alt="" width="640" height="360" loading="lazy" />
      </div>
      <h1 class="page-title plain" style="margin-bottom: 0.5rem">
        {{ card.title || t("common.unnamed") }}
      </h1>
      <p class="muted">
        <VisibilityBadge :visibility="card.visibility" />
        {{ formatDateTime(card.createdAt) }}
      </p>
      <p>{{ card.summary || t("card.noSummary") }}</p>
      <div class="sub-panel">
        <p class="section-head" style="margin-top: 0">{{ t("card.payloadTitle") }}</p>
        <EmptyState
          v-if="payloadKeys().length === 0"
          :title="t('card.payloadEmpty')"
          :hint="t('card.payloadEmptyHint')"
        />
        <ul v-else class="payload-list">
          <li v-for="k in payloadKeys()" :key="k">
            <code translate="no">{{ k }}</code>
            <span class="muted"> — {{ t("card.payloadRedacted") }}</span>
          </li>
        </ul>
      </div>
      <p class="muted">{{ t("card.noContact") }}</p>
      <button type="button" @click="onExchange">
        <ExchangeIcon class="btn-icon" aria-hidden="true" />
        {{ t("plaza.exchange") }}
      </button>
      <p v-if="exchangeMsg" class="muted" aria-live="polite">{{ exchangeMsg }}</p>
    </article>
  </template>
</template>
