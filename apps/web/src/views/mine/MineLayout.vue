<script setup>
import MineTabs from "../../components/MineTabs.vue";
import { t } from "../../i18n/index.js";
import { useSessionStore } from "../../stores/session";

const session = useSessionStore();
</script>

<template>
  <template v-if="!session.user">
    <p class="muted">
      <RouterLink to="/">{{ t("mine.backHome") }}</RouterLink>
    </p>
    <div class="card hero-panel guest-hero">
      <p class="chip">{{ t("home.tagline") }}</p>
      <h2 class="page-title plain">{{ t("mine.guestTitle") }}</h2>
      <p class="muted">{{ t("mine.guestIntro") }}</p>
      <div class="hero-actions">
        <RouterLink to="/login" class="button-link">{{ t("mine.guestCta") }}</RouterLink>
      </div>
    </div>
  </template>
  <template v-else>
    <p class="muted">
      <RouterLink to="/">{{ t("mine.backHome") }}</RouterLink>
    </p>
    <p class="chip">{{ t("home.tagline") }}</p>
    <h1 class="page-title">{{ t("mine.consoleTitle") }}</h1>
    <MineTabs />
    <RouterView />
  </template>
</template>
