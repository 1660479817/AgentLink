<script setup>
import { onMounted, ref } from "vue";
import { toPlain } from "@knot/markdown";
import ActorMark from "../components/ActorMark.vue";
import AppButton from "../components/AppButton.vue";
import RecordMedia from "../components/RecordMedia.vue";
import StatusIcon from "../components/StatusIcon.vue";
import VideoFrame from "../components/VideoFrame.vue";
import { listSubmissions } from "../api.js";
import { kindKey, priceOf, statusKey } from "../record.js";
import { t } from "../i18n/index.js";
import { PaperclipIcon } from "../icons/index.js";
import { packetFile, packetVideos } from "../packet.js";
import { altLabel } from "../mediaLabel.js";

const items = ref([]);
const loaded = ref(false);

onMounted(async () => {
  try {
    const data = await listSubmissions();
    items.value = data.submissions || [];
  } catch {
    items.value = [];
  } finally {
    loaded.value = true;
  }
});

function fileNote(item) {
  const note = String(item.kMeta?.note || "").trim();
  if (note) return note;
  if ((item.kMeta?.verdict || "pending") === "pending") return t("home.filePrechecked");
  return "";
}
</script>

<template>
  <h1 class="page-title">{{ t("submissions.title") }}</h1>
  <p v-if="loaded && items.length === 0" class="muted">{{ t("submissions.empty") }}</p>
  <article v-for="item in items" :key="item.id" class="card post">
    <p class="information-status">
      <ActorMark :actor="item.actor" />
      <StatusIcon :verdict="item.kMeta?.verdict || 'pending'" />
      {{ t(statusKey(item.kMeta?.verdict)) }}
    </p>
    <p class="information-time">
      <span>{{ t(kindKey(item.kMeta?.kind)) }}</span>
      <span v-if="item.kMeta?.category"> · {{ item.kMeta.category }}</span>
      <span v-if="item.kMeta?.language"> · {{ item.kMeta.language }}</span>
      <!-- 内容不带价；只有货架上的商品有价格。 -->
      <span v-if="priceOf(item) > 0"> · {{ t("submissions.usePrice", { n: priceOf(item) }) }}</span>
      <span v-else-if="item.kMeta?.public === false && item.kMeta?.verdict !== 'removed'"> · {{ t("submissions.private") }}</span>
    </p>
    <p v-if="item.body" class="information-body">{{ toPlain(item.body) }}</p>
    <RecordMedia :images="item.images" :audio="item.audio" :label="altLabel(item.body)" />
    <VideoFrame
      v-if="packetVideos(item.videos)[0]"
      :url="packetVideos(item.videos)[0].url"
      :poster="packetVideos(item.videos)[0].poster || ''"
      :play-url="packetVideos(item.videos)[0].playUrl || ''"
      :label="altLabel(item.body)"
    />
    <ul v-if="packetFile(item.attachments).length" class="information-files">
      <li v-for="file in packetFile(item.attachments)" :key="file.id">
        <span class="information-file">
          <PaperclipIcon class="information-file-icon" aria-hidden="true" />
          <span class="information-file-copy">
            <span class="information-file-name">{{ file.name || t("home.file") }}</span><span v-if="fileNote(item)" class="information-file-note">{{ t("home.fileNoteJoin", { note: fileNote(item) }) }}</span>
          </span>
        </span>
      </li>
    </ul>
    <p v-if="item.kMeta?.rejectReason" class="error card-notice" role="alert">{{ item.kMeta.rejectReason }}</p>
  </article>
  <div class="form-actions">
    <AppButton variant="secondary" to="/mine">{{ t("submissions.back") }}</AppButton>
  </div>
</template>
