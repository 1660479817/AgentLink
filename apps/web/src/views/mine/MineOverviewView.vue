<script setup>
import { computed } from "vue";
import { t } from "../../i18n/index.js";
import { useInfoBufferStore } from "../../stores/infoBuffer";

const buffer = useInfoBufferStore();
const mine = computed(() => buffer.surfaces.mine);
const welcome = computed(() => mine.value?.welcome);
const exchange = computed(() => mine.value?.exchange);
</script>

<template>
  <p v-if="buffer.errors.mine === 'REGISTER_REQUIRED'" class="error">{{ t("mine.relogin") }}</p>
  <div class="card welcome-strip">
    <h2 style="margin-top: 0">{{ t("mine.welcome") }}</h2>
    <template v-if="welcome">
      <p class="muted" translate="no">{{ welcome.email }}</p>
      <p class="muted">
        {{ t("mine.agentLabel") }}：
        {{ welcome.agentTokenActive ? t("mine.agentConfigured") : t("mine.agentNotConfigured") }}
        <RouterLink :to="{ name: 'mine-settings' }">{{ t("mine.agentSettings") }}</RouterLink>
      </p>
      <p v-if="welcome.ingestProcessingCount > 0" class="muted">
        <RouterLink :to="{ name: 'mine-publish' }">
          {{ t("mine.ingestProcessing", { count: welcome.ingestProcessingCount }) }}
        </RouterLink>
      </p>
    </template>
    <p v-else class="muted">{{ t("home.syncing") }}</p>
    <div class="stat-row" style="margin-top: 1rem">
      <div class="stat-pill">
        <div class="stat-value">{{ exchange?.msgboxUnread ?? 0 }}</div>
        <div class="muted stat-label">{{ t("mine.statMsgbox") }}</div>
      </div>
      <div class="stat-pill">
        <div class="stat-value">{{ exchange?.keysHandedOffToday ?? 0 }}</div>
        <div class="muted stat-label">{{ t("mine.statHandoffToday") }}</div>
      </div>
    </div>
    <div class="quick-actions" style="margin-top: 1rem">
      <RouterLink to="/plaza" class="button-link secondary">{{ t("home.quickPlaza") }}</RouterLink>
      <RouterLink :to="{ name: 'mine-publish' }" class="button-link secondary">{{
        t("home.quickProvide")
      }}</RouterLink>
      <RouterLink :to="{ name: 'mine-cards' }" class="button-link secondary">{{
        t("home.quickCards")
      }}</RouterLink>
      <RouterLink :to="{ name: 'mine-exchange' }" class="button-link secondary">{{
        t("mine.tabExchange")
      }}</RouterLink>
    </div>
  </div>
</template>
