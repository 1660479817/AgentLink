<script setup>
import { computed } from "vue";
import { t } from "../../i18n/index.js";
import { useInfoBufferStore } from "../../stores/infoBuffer";

const buffer = useInfoBufferStore();
const welcome = computed(() => buffer.surfaces.mine?.welcome);
</script>

<template>
  <div class="card">
    <h2 style="margin-top: 0">{{ t("mine.settingsTitle") }}</h2>
    <h3 style="font-size: 1rem">{{ t("mine.settingsAccount") }}</h3>
    <p class="muted" translate="no">{{ buffer.viewer?.email ?? welcome?.email ?? "—" }}</p>
    <h3 style="font-size: 1rem">{{ t("mine.settingsAgent") }}</h3>
    <p class="muted">
      {{ welcome?.agentTokenActive ? t("mine.agentConfigured") : t("mine.agentNotConfigured") }}
    </p>
    <RouterLink :to="{ name: 'agent' }" class="button-link">{{ t("mine.settingsAgentLink") }}</RouterLink>
    <h3 style="font-size: 1rem; margin-top: 1.25rem">{{ t("mine.settingsPoints") }}</h3>
    <p class="muted">{{ t("mine.settingsPointsEmpty") }}</p>
  </div>
</template>
