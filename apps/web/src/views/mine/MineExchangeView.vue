<script setup>
import { computed } from "vue";
import EmptyState from "../../components/EmptyState.vue";
import { ExchangeIcon } from "../../icons/index.js";
import { formatDateTime } from "../../lib/format.js";
import { t } from "../../i18n/index.js";
import { useInfoBufferStore } from "../../stores/infoBuffer";

const buffer = useInfoBufferStore();
const exchange = computed(() => buffer.surfaces.mine?.exchange ?? {});
const threads = computed(() => exchange.value.threads ?? []);
const handoffs = computed(() => exchange.value.handoffs ?? []);
</script>

<template>
  <div class="card">
    <h2 style="margin-top: 0">{{ t("mine.exchangeTitle") }}</h2>
    <p class="muted">{{ t("mine.exchangeIntro") }}</p>
    <p class="muted">
      {{
        t("mine.exchangeStats", {
          unread: exchange.msgboxUnread ?? 0,
          handoff: exchange.keysHandedOffToday ?? 0,
        })
      }}
    </p>
  </div>
  <section class="card">
    <h3 style="margin-top: 0">{{ t("mine.msgboxTitle") }}</h3>
    <EmptyState
      v-if="threads.length === 0"
      :icon="ExchangeIcon"
      :title="t('mine.msgboxEmpty')"
      :hint="t('mine.msgboxEmptyHint')"
    />
    <ul v-else class="exchange-list">
      <li v-for="row in threads" :key="row.id">{{ row.title }} · {{ formatDateTime(row.updatedAt) }}</li>
    </ul>
  </section>
  <section class="card">
    <h3 style="margin-top: 0">{{ t("mine.handoffTitle") }}</h3>
    <EmptyState v-if="handoffs.length === 0" :title="t('mine.handoffEmpty')" :hint="t('mine.handoffEmptyHint')" />
    <ul v-else class="exchange-list">
      <li v-for="row in handoffs" :key="row.id">
        {{ row.cardTitle ?? row.id }} · {{ formatDateTime(row.at) }}
      </li>
    </ul>
  </section>
</template>
