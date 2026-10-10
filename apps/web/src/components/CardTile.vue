<script setup>
import { useRouter } from "vue-router";
import VisibilityBadge from "./VisibilityBadge.vue";
import { ExchangeIcon } from "../icons/index.js";
import { formatDateTime } from "../lib/format.js";
import { t } from "../i18n/index.js";

const props = defineProps({
  card: { type: Object, required: true },
  showExchange: { type: Boolean, default: true },
});

const emit = defineEmits(["exchange"]);
const router = useRouter();

function goDetail() {
  router.push({ name: "card", params: { id: props.card.id } });
}
</script>

<template>
  <article class="card info-card">
    <div v-if="card.thumbUrl" class="media-frame" style="margin-bottom: 0.65rem">
      <img :src="card.thumbUrl" alt="" width="320" height="180" loading="lazy" />
    </div>
    <h3>
      <a href="#" @click.prevent="goDetail">{{ card.title || t("common.unnamed") }}</a>
    </h3>
    <p class="card-summary">{{ card.summary || "" }}</p>
    <p class="muted">
      <VisibilityBadge :visibility="card.visibility" />
      {{ formatDateTime(card.createdAt) }}
    </p>
    <div class="card-actions">
      <RouterLink :to="{ name: 'card', params: { id: card.id } }" class="button-link secondary">
        {{ t("card.detail") }}
      </RouterLink>
      <button v-if="showExchange" type="button" @click="emit('exchange', card.id)">
        <ExchangeIcon class="btn-icon" aria-hidden="true" />
        {{ t("plaza.exchange") }}
      </button>
    </div>
  </article>
</template>
