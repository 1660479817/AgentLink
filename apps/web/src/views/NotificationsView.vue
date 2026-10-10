<script setup>
import { onMounted } from "vue";
import { t } from "../i18n/index.js";
import { useNotificationStore } from "../stores/notifications";

const notifications = useNotificationStore();

onMounted(() => notifications.open());
</script>

<template>
  <h1 class="page-title">{{ t("notifications.title") }}</h1>
  <p class="muted">{{ t("notifications.hint") }}</p>
  <p v-if="notifications.loaded && notifications.items.length === 0" class="muted">
    {{ t("notifications.empty") }}
  </p>
  <article v-for="item in notifications.items" :key="item.id" class="card post" :class="{ 'is-unread': !item.read }">
    <h2 class="post-name">{{ item.title }}</h2>
    <p v-if="item.body" class="post-body">{{ item.body }}</p>
    <p v-if="item.href" class="muted">
      <RouterLink :to="item.href">{{ t("notifications.openLink") }}</RouterLink>
    </p>
  </article>
</template>
