<script setup>
import { watch } from "vue";
import { useRouter } from "vue-router";
import DownloadConsent from "./components/DownloadConsent.vue";
import AppShell from "./layouts/AppShell.vue";
import { updateProfile } from "./api.js";
import { t } from "./i18n/index.js";
import { useLocaleStore } from "./stores/locale.js";
import { useSessionStore } from "./stores/session";

const router = useRouter();
const session = useSessionStore();
const locale = useLocaleStore();
let syncing = "";

// 退出登录或会话过期后，站内浏览关着的话回登录/注册页。
watch(
  () => [session.ready, session.canBrowse],
  () => {
    if (!session.ready || session.canBrowse) return;
    if (router.currentRoute.value.name !== "gate") router.replace({ name: "gate" });
  }
);

watch(
  () => [session.ready, session.user?.id || "", session.user?.locale || "", session.region],
  () => {
    if (!session.ready) return;
    const result = locale.applySession({ user: session.user, region: session.region });
    if (!result.sync || !session.user || syncing === result.sync) return;
    const id = result.sync;
    syncing = id;
    updateProfile({ locale: id })
      .then((data) => {
        if (session.user) session.user = data.user;
      })
      .catch(() => {})
      .finally(() => {
        if (syncing === id) syncing = "";
      });
  }
);
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
