<script setup>
import { onMounted, ref } from "vue";
import AppButton from "../components/AppButton.vue";
import { listSubmissions } from "../api.js";
import { t } from "../i18n/index.js";
import { PaperclipIcon } from "../icons/index.js";
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

function imagesOf(item) {
  return item.images?.length ? item.images : (item.attachments || []).filter((file) => file.image);
}

function filesOf(item) {
  return item.images ? item.attachments || [] : (item.attachments || []).filter((file) => !file.image);
}
</script>

<template>
  <h1 class="page-title">{{ t("submissions.title") }}</h1>
  <p v-if="!session.user" class="muted">{{ t("mine.login") }}</p>
  <p v-else-if="loaded && items.length === 0" class="muted">{{ t("submissions.empty") }}</p>
  <article v-for="item in items" :key="item.id" class="card post">
    <p class="information-status">{{ t(statusKey(item.verdict)) }}</p>
    <p v-if="item.body" class="information-body">{{ item.body }}</p>
    <div v-if="imagesOf(item).length" class="information-images">
      <img v-for="file in imagesOf(item)" :key="file.id" :src="file.url" alt="" class="information-photo" />
    </div>
    <ul v-if="filesOf(item).length" class="information-files">
      <li v-for="file in filesOf(item)" :key="file.id">
        <a class="information-file" :href="file.url">
          <PaperclipIcon class="information-file-icon" aria-hidden="true" />
          <span>{{ file.name || t("home.file") }}</span>
        </a>
      </li>
    </ul>
    <p v-if="item.rejectReason" class="error" role="alert">{{ item.rejectReason }}</p>
    <p v-if="item.reward" class="muted">{{ t("submissions.intelReward", { n: item.reward }) }}</p>
  </article>
  <div class="form-actions">
    <AppButton variant="secondary" to="/mine">{{ t("submissions.back") }}</AppButton>
  </div>
</template>
