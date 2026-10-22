<script setup>
import { onMounted, ref } from "vue";
import { toPlain } from "@knot/markdown";
import ActorMark from "../components/ActorMark.vue";
import AppButton from "../components/AppButton.vue";
import RecordMedia from "../components/RecordMedia.vue";
import StatusIcon from "../components/StatusIcon.vue";
import VideoFrame from "../components/VideoFrame.vue";
import { listSubmissions, reopenInformation } from "../api.js";
import { hoursLeftOf } from "../record.js";
import { t } from "../i18n/index.js";
import { PaperclipIcon } from "../icons/index.js";
import { packetFile, packetVideos } from "../packet.js";
import { altLabel } from "../mediaLabel.js";

const items = ref([]);
const loaded = ref(false);

// 时效在取回时算一次，挂在条目上：列表渲染不再重复算，也不发额外请求。
function withExpiry(item) {
  return { ...item, expiryLeft: hoursLeftOf(item) };
}

onMounted(async () => {
  try {
    const data = await listSubmissions();
    items.value = (data.submissions || []).map(withExpiry);
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

function statusKey(status) {
  if (status === "passed") return "submissions.statusPublished";
  if (status === "rejected") return "submissions.statusRejected";
  if (status === "removed") return "submissions.statusRemoved";
  return "submissions.statusPending";
}

// 出售帖 = post/fastpost、有存储的下载附件、且标价大于 0。与后端 SALE_POST 同口径：
// item.attachments 已是「非图片、非音频」的分类（card.toRecord），stored=true 表示上传的。
function isSale(item) {
  const kind = item.kMeta?.kind;
  if (kind !== "post" && kind !== "fastpost") return false;
  if (!(Number(item.kMeta?.commerce?.price) > 0)) return false;
  return (item.attachments || []).some((file) => file?.stored);
}

function saleExpired(item) {
  return item.expiryLeft === 0;
}

async function reopen(item) {
  if (item.reopening) return;
  item.reopening = true;
  item.reopenError = "";
  try {
    const data = await reopenInformation(item.id);
    if (data?.intel?.kMeta) item.kMeta = { ...(item.kMeta || {}), ...data.intel.kMeta };
    // 再次开放之后有效期重置，按新时间重算这一行的剩余小时。
    item.expiryLeft = hoursLeftOf(item);
  } catch {
    item.reopenError = t("error.request_failed");
  } finally {
    item.reopening = false;
  }
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
      <span v-if="item.kMeta?.category">{{ item.kMeta.category }} · </span>
      <span v-if="item.kMeta?.language">{{ item.kMeta.language }} · </span>
      <span>{{ t("submissions.usePrice", { n: item.kMeta?.commerce?.price || 0 }) }}</span>
      <span v-if="item.kMeta?.kind === 'wishRespond'"> · {{ t("submissions.requestReply") }}</span>
      <span v-else-if="item.kMeta?.kind === 'wish'"> · {{ t("submissions.request") }}</span>
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
    <p v-if="item.expiryLeft !== null" class="muted submission-expiry" :class="{ 'is-expired': item.expiryLeft === 0 }">
      <span>
        {{ item.expiryLeft === 0 ? t("home.expiryExpired") : t("home.expiryLeft", { n: item.expiryLeft }) }}
      </span>
      <AppButton v-if="saleExpired(item) && isSale(item)" variant="secondary" type="button" :disabled="item.reopening" @click="reopen(item)">
        {{ t("submissions.reopen") }}
      </AppButton>
    </p>
    <p v-if="item.reopenError" class="error card-notice" role="alert">{{ item.reopenError }}</p>
  </article>
  <div class="form-actions">
    <AppButton variant="secondary" to="/mine">{{ t("submissions.back") }}</AppButton>
  </div>
</template>
