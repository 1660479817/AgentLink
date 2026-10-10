<script setup>
import { onMounted, ref } from "vue";
import AppButton from "../components/AppButton.vue";
import { listSubmissions } from "../api.js";
import { t } from "../i18n/index.js";
import { useSessionStore } from "../stores/session";

const session = useSessionStore();
const items = ref([]);
const loaded = ref(false);

onMounted(async () => {
  if (!session.person) await session.start();
  try {
    const data = await listSubmissions();
    items.value = data.submissions;
  } catch {
    items.value = [];
  } finally {
    loaded.value = true;
  }
});

function statusKey(status) {
  if (status === "published") return "submissions.statusPublished";
  if (status === "rejected") return "submissions.statusRejected";
  return "submissions.statusPending";
}
</script>

<template>
  <h1 class="page-title">{{ t("submissions.title") }}</h1>
  <p v-if="!session.person" class="muted">{{ t("mine.login") }}</p>
  <p v-else-if="loaded && items.length === 0" class="muted">{{ t("submissions.empty") }}</p>
  <article v-for="item in items" :key="item.id" class="card post">
    <header class="post-head information-head">
      <span class="role-badge" :data-role="item.role">{{ t(`role.${item.role}`) }}</span>
      <span class="muted">{{ t(statusKey(item.reviewStatus)) }}</span>
    </header>
    <p class="post-body">{{ item.body }}</p>
    <p v-if="item.summary" class="muted">{{ t("submissions.cardSummary", { text: item.summary }) }}</p>
    <p v-if="item.intelClass" class="muted">{{ t("submissions.intelClass", { category: item.intelClass.category }) }}</p>
    <p v-if="item.evaluation" class="muted">{{ t("submissions.evaluation", { n: item.evaluation.score }) }}</p>
    <p v-if="item.rejectReason" class="error" role="alert">{{ item.rejectReason }}</p>
    <p v-if="item.intelReward" class="muted">{{ t("submissions.intelReward", { n: item.intelReward }) }}</p>
  </article>
  <div class="form-actions">
    <AppButton variant="secondary" to="/mine">{{ t("submissions.back") }}</AppButton>
  </div>
</template>
