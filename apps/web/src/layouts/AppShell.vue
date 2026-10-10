<script setup>
import { useRouter } from "vue-router";
import NavLinkItem from "../components/NavLinkItem.vue";
import { HomeIcon, LogInIcon, LogOutIcon, PlazaIcon, UserIcon } from "../icons/index.js";
import { t } from "../i18n/index.js";
import { authLogout } from "../api.js";
import { useSessionStore } from "../stores/session";

const session = useSessionStore();
const router = useRouter();

async function logout() {
  await authLogout();
  session.setUser(null);
  router.push({ name: "login" });
}
</script>

<template>
  <div class="layout">
    <a href="#main-content" class="skip-link">{{ t("app.skipToContent") }}</a>
    <header class="site-header">
      <RouterLink to="/" class="brand">
        <span class="brand-mark" aria-hidden="true" />
        {{ t("app.name") }}
      </RouterLink>
      <nav class="top-nav" :aria-label="t('app.name')">
        <template v-if="session.user">
          <NavLinkItem to="/" :icon="HomeIcon" :label="t('nav.home')" end />
          <NavLinkItem to="/plaza" :icon="PlazaIcon" :label="t('nav.plaza')" />
          <NavLinkItem to="/mine" :icon="UserIcon" :label="t('nav.mine')" />
          <span class="muted nav-email" translate="no">{{ session.user.email }}</span>
          <button type="button" class="secondary nav-icon-btn" :aria-label="t('nav.logout')" @click="logout">
            <LogOutIcon class="nav-icon" aria-hidden="true" />
            <span>{{ t("nav.logout") }}</span>
          </button>
        </template>
        <template v-else>
          <NavLinkItem to="/" :icon="HomeIcon" :label="t('nav.home')" end />
          <NavLinkItem to="/plaza" :icon="PlazaIcon" :label="t('nav.plaza')" />
          <NavLinkItem to="/mine" :icon="UserIcon" :label="t('nav.mine')" />
          <NavLinkItem to="/login" :icon="LogInIcon" :label="t('nav.login')" />
        </template>
      </nav>
    </header>
    <main id="main-content">
      <slot />
    </main>
  </div>
</template>
