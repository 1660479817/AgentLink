<script setup>
import { AgentIcon, ExchangeIcon, UploadIcon, UserIcon } from "../icons/index.js";
import { t } from "../i18n/index.js";

const tabs = [
  { name: "mine-overview", labelKey: "mine.tabOverview", icon: UserIcon },
  { name: "mine-cards", labelKey: "mine.tabCards", icon: UserIcon },
  { name: "mine-publish", labelKey: "mine.tabPublish", icon: UploadIcon },
  { name: "mine-exchange", labelKey: "mine.tabExchange", icon: ExchangeIcon },
  { name: "mine-settings", labelKey: "mine.tabSettings", icon: AgentIcon },
];
</script>

<template>
  <nav class="mine-tabs" :aria-label="t('mine.guestTitle')">
    <RouterLink
      v-for="tab in tabs"
      :key="tab.name"
      :to="{ name: tab.name }"
      class="mine-tab"
      active-class="is-active"
    >
      <component :is="tab.icon" class="nav-icon" aria-hidden="true" />
      <span>{{ t(tab.labelKey) }}</span>
    </RouterLink>
  </nav>
</template>
