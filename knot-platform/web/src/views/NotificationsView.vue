<script setup>
import { computed, onMounted } from "vue";
import { toPlain } from "@knot/markdown";
import StatusIcon from "../components/StatusIcon.vue";
import { BellIcon } from "../icons/index.js";
import { locale, t } from "../i18n/index.js";
import { internalHref } from "../links.js";
import { createNoticeText } from "../noticeText.js";
import { useNotificationStore } from "../stores/notifications";

const notifications = useNotificationStore();
// 标题与正文按界面语言重出；认不出的 kind 或缺 data 的旧记录用库里的原文。
const notice = createNoticeText(t, () => locale.value);
const items = computed(() =>
  notifications.items.map((item) => ({
    ...item,
    titleText: notice.noticeTitle(item),
    bodyText: toPlain(notice.noticeBody(item)),
    // href 来自库里的字符串，后端不校验：非站内路径不交给 RouterLink。
    hrefOk: internalHref(item.href),
  }))
);

onMounted(() => notifications.open());
</script>

<template>
  <div class="notice-page">
    <h1 class="page-title">{{ t("notifications.title") }}</h1>
    <p class="muted">{{ t("notifications.hint") }}</p>
    <p v-if="notifications.failed" class="error" role="alert">{{ t("error.request_failed") }}</p>
    <p v-else-if="notifications.loaded && notifications.items.length === 0" class="muted empty-line">
      <BellIcon class="empty-icon" aria-hidden="true" />
      <span>{{ t("notifications.empty") }}</span>
    </p>
    <article v-for="item in items" :key="item.id" class="card post" :class="{ 'is-unread': !item.read }">
      <h2 class="post-name notice-title">
        <StatusIcon :kind="item.kind" />
        <span>{{ item.titleText }}</span>
      </h2>
      <p v-if="item.bodyText" class="post-body">{{ item.bodyText }}</p>
      <p v-if="item.hrefOk" class="muted">
        <RouterLink :to="item.href">{{ t("notifications.openLink") }}</RouterLink>
      </p>
    </article>
  </div>
</template>
