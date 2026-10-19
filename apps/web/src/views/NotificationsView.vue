<script setup>
import { onMounted } from "vue";
import { toPlain } from "@knot/markdown";
import StatusIcon from "../components/StatusIcon.vue";
import { BellIcon } from "../icons/index.js";
import { t } from "../i18n/index.js";
import { useNotificationStore } from "../stores/notifications";

const notifications = useNotificationStore();

onMounted(() => notifications.open());
</script>

<template>
  <div class="notice-page">
    <h1 class="page-title">{{ t("notifications.title") }}</h1>
    <p class="muted">{{ t("notifications.hint") }}</p>
    <p v-if="notifications.loaded && notifications.items.length === 0" class="muted empty-line">
      <BellIcon class="empty-icon" aria-hidden="true" />
      <span>{{ t("notifications.empty") }}</span>
    </p>
    <article v-for="item in notifications.items" :key="item.id" class="card post" :class="{ 'is-unread': !item.read }">
      <h2 class="post-name notice-title">
        <StatusIcon :kind="item.kind" />
        <span>{{ item.title }}</span>
      </h2>
      <p v-if="item.body" class="post-body">{{ toPlain(item.body) }}</p>
      <p v-if="item.href" class="muted">
        <RouterLink :to="item.href">{{ t("notifications.openLink") }}</RouterLink>
      </p>
    </article>
  </div>
</template>
