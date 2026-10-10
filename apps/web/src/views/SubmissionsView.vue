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
  if (!session.user) {
    loaded.value = true;
    return;
  }
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
  if (status === "passed") return "submissions.statusPublished";
  if (status === "rejected") return "submissions.statusRejected";
  return "submissions.statusPending";
}
</script>

<template>
  <h1 class="page-title">{{ t("submissions.title") }}</h1>
  <p v-if="!session.user" class="muted">{{ t("mine.login") }}</p>
  <p v-else-if="loaded && items.length === 0" class="muted">{{ t("submissions.empty") }}</p>
  <article v-for="item in items" :key="item.id" class="card post">
    <header class="post-head information-head">
      <span class="role-badge" data-role="intel">{{ t("role.intel") }}</span>
      <span class="muted">{{ t(statusKey(item.verdict)) }}</span>
    </header>
    <div v-if="item.attachments?.length" class="information-files">
      <template v-for="file in item.attachments" :key="file.id">
        <img v-if="file.image" :src="file.url" alt="" class="information-photo" />
        <a v-else class="chat-file-link" :href="file.url">{{ file.name || t("home.file") }}</a>
      </template>
    </div>
    <p v-if="item.body" class="post-body">{{ item.body }}</p>
    <p v-if="item.rejectReason" class="error" role="alert">{{ item.rejectReason }}</p>
    <p v-if="item.reward" class="muted">{{ t("submissions.intelReward", { n: item.reward }) }}</p>
  </article>
  <div class="form-actions">
    <AppButton variant="secondary" to="/mine">{{ t("submissions.back") }}</AppButton>
  </div>
</template>
