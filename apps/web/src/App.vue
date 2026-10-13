<script setup>
import { onMounted } from "vue";
import DownloadConsent from "./components/DownloadConsent.vue";
import AppShell from "./layouts/AppShell.vue";
import { useSessionStore } from "./stores/session";
import { t } from "./i18n/index.js";

const session = useSessionStore();

onMounted(() => {
  session.load();
});
</script>

<template>
  <DownloadConsent />
  <AppShell v-if="session.ready">
    <RouterView />
  </AppShell>
  <div v-else class="layout boot-screen">
    <span class="brand-mark" aria-hidden="true" />
    <p class="muted">{{ t("app.loading") }}</p>
  </div>
</template>
