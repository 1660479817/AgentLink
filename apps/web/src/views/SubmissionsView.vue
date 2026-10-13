<script setup>
import { onMounted, ref } from "vue";
import AppButton from "../components/AppButton.vue";
import VideoFrame from "../components/VideoFrame.vue";
import { listSubmissions } from "../api.js";
import { t } from "../i18n/index.js";
import { AudioIcon, ImageIcon, PaperclipIcon } from "../icons/index.js";
import { lockedImages, packetAudio, packetFile, packetVideos, photoUrls } from "../packet.js";
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
  if (status === "removed") return "submissions.statusRemoved";
  return "submissions.statusPending";
}

function imagesOf(item) {
  return item.images?.length ? item.images : (item.attachments || []).filter((file) => file.image);
}

function photosOf(item) {
  return photoUrls([], imagesOf(item));
}

function pendingOf(item) {
  return lockedImages([], imagesOf(item));
}

</script>

<template>
  <h1 class="page-title">{{ t("submissions.title") }}</h1>
  <p v-if="!session.user" class="muted">{{ t("mine.login") }}</p>
  <p v-else-if="loaded && items.length === 0" class="muted">{{ t("submissions.empty") }}</p>
  <article v-for="item in items" :key="item.id" class="card post">
    <p class="information-status">{{ t(statusKey(item.verdict)) }}</p>
    <p class="information-time">
      <span v-if="item.category">{{ item.category }} · </span>
      <span>{{ t("submissions.usePrice", { n: item.price || 0 }) }}</span>
      <span v-if="item.kind === 'response'"> · {{ t("submissions.requestReply") }}</span>
      <span v-else-if="item.kind === 'request'"> · {{ t("submissions.request") }}</span>
      <span v-else-if="item.public === false && item.verdict !== 'removed'"> · {{ t("submissions.private") }}</span>
    </p>
    <p v-if="item.body" class="information-body">{{ item.body }}</p>
    <img v-if="item.previewUrl" :src="item.previewUrl" alt="" class="information-preview" />
    <div v-else-if="photosOf(item).length" class="information-images" :class="`is-${photosOf(item).length}`">
      <img v-for="url in photosOf(item)" :key="url" :src="url" alt="" class="information-photo" />
    </div>
    <ul v-else-if="pendingOf(item).length" class="information-files">
      <li v-for="file in pendingOf(item)" :key="file.id">
        <span class="information-file">
          <ImageIcon class="information-file-icon" aria-hidden="true" />
          <span>{{ file.name || t("home.image") }}</span>
        </span>
      </li>
    </ul>
    <div v-if="packetAudio(item.audio).length" class="information-audio">
      <template v-for="file in packetAudio(item.audio)" :key="file.id || file.name">
        <audio v-if="file.url" :src="file.url" controls :aria-label="file.name || t('home.audio')" />
        <span v-else class="information-file">
          <AudioIcon class="information-file-icon" aria-hidden="true" />
          <span>{{ file.name || t("home.audio") }}</span>
        </span>
      </template>
    </div>
    <VideoFrame
      v-if="packetVideos(item.videos)[0]"
      :url="packetVideos(item.videos)[0].url"
      :poster="packetVideos(item.videos)[0].poster || ''"
    />
    <ul v-if="packetFile(item.attachments).length" class="information-files">
      <li v-for="file in packetFile(item.attachments)" :key="file.id">
        <a v-if="file.url" class="information-file" :href="file.url">
          <PaperclipIcon class="information-file-icon" aria-hidden="true" />
          <span>{{ file.name || t("home.file") }}</span>
        </a>
        <span v-else class="information-file">
          <PaperclipIcon class="information-file-icon" aria-hidden="true" />
          <span>{{ file.name || t("home.file") }}</span>
        </span>
      </li>
    </ul>
    <p v-if="item.rejectReason" class="error card-notice" role="alert">{{ item.rejectReason }}</p>
  </article>
  <div class="form-actions">
    <AppButton variant="secondary" to="/mine">{{ t("submissions.back") }}</AppButton>
  </div>
</template>
