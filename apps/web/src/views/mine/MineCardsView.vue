<script setup>
import { computed } from "vue";
import CardTile from "../../components/CardTile.vue";
import EmptyState from "../../components/EmptyState.vue";
import { t } from "../../i18n/index.js";
import { useInfoBufferStore } from "../../stores/infoBuffer";

const buffer = useInfoBufferStore();
const cards = computed(() => buffer.surfaces.mine?.myCards ?? []);
</script>

<template>
  <h2 style="font-size: 1.1rem">{{ t("mine.myCardsTitle") }}</h2>
  <div v-if="cards.length === 0" class="card">
    <EmptyState :title="t('mine.emptyCards')" :hint="t('mine.emptyCardsHint')" />
    <RouterLink :to="{ name: 'mine-publish' }" class="button-link">{{ t("mine.tabPublish") }}</RouterLink>
  </div>
  <div v-else class="grid-cards">
    <CardTile v-for="c in cards" :key="c.id" :card="c" :show-exchange="false" />
  </div>
</template>
