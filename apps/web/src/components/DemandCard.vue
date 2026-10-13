<script setup>
import { ref } from "vue";
import AppButton from "./AppButton.vue";
import VideoFrame from "./VideoFrame.vue";
import { t } from "../i18n/index.js";
import { AudioIcon, DownloadIcon, EditIcon, ImageIcon, PaperclipIcon, StarIcon, StopIcon } from "../icons/index.js";
import { lockedImages, packetAudio, packetFile, packetVideos, photoUrls } from "../packet.js";
import { useSessionStore } from "../stores/session";

const props = defineProps({
  demand: { type: Object, required: true },
  stopping: { type: Boolean, default: false },
  notice: { type: String, default: "" },
  downloadingId: { type: String, default: "" },
});

const emit = defineEmits(["stop", "edit", "star", "download"]);
const session = useSessionStore();

function shownImages(reply) {
  return photoUrls([], reply.images);
}

function pendingImages(reply) {
  return lockedImages([], reply.images);
}

function shownAudio(reply) {
  return packetAudio(reply.audio);
}

function shownVideos(reply) {
  return packetVideos(reply.videos);
}

function shownFile(reply) {
  return packetFile(reply.attachments);
}

const confirmingId = ref("");

function hasPacketFiles(reply) {
  return (reply.images || []).length || (reply.audio || []).length || (reply.attachments || []).length;
}

function onDownload(reply) {
  if (props.downloadingId) return;
  const price = Number(reply.price) || 0;
  if (price > 0 && reply.granted === false && confirmingId.value !== reply.id) {
    confirmingId.value = reply.id;
    return;
  }
  emit("download", reply);
}

function stamp(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${pick("year")}-${pick("month")}-${pick("day")} ${pick("hour")}:${pick("minute")}`;
}

function timeLabel(value) {
  const time = stamp(value);
  return time ? t("buy.time", { time }) : "";
}

function systemText(reply) {
  if (reply.code === "working") return t("buy.systemWorking");
  if (reply.code === "delivered") return t("buy.systemDelivered", { count: reply.count || 0 });
  if (reply.code === "empty") return t("buy.systemEmpty");
  if (reply.code === "stopped") return t("buy.systemStopped");
  if (reply.code === "timeout") return t("buy.systemTimeout", { hours: session.policy.demandTtlHours });
  if (reply.code === "review") return t("buy.systemReview");
  return "";
}

function filesOf(item) {
  return [...(item?.images || []), ...(item?.attachments || [])];
}
</script>

<template>
  <article class="card demand-card">
    <header class="demand-block">
      <p class="demand-kicker">
        <span>{{ t("buy.task") }}</span>
        <span class="demand-time">{{ timeLabel(demand.createdAt) }}</span>
      </p>
      <p v-if="demand.brief" class="demand-text">{{ demand.brief }}</p>
      <div v-if="filesOf(demand).length" class="chat-attachments">
        <template v-for="file in filesOf(demand)" :key="file.id">
          <img v-if="file.image || file.mime?.startsWith('image/')" :src="file.url" alt="" class="chat-thumb" />
          <a v-else class="chat-file-link" :href="file.url">{{ file.name || t("buy.file") }}</a>
        </template>
      </div>
      <div class="demand-actions">
        <AppButton
          variant="icon"
          type="button"
          :aria-label="t('buy.stop')"
          :disabled="stopping || demand.status !== 'open'"
          @click="emit('stop')"
        >
          <StopIcon aria-hidden="true" />
        </AppButton>
        <AppButton
          variant="icon"
          type="button"
          :aria-label="t('buy.edit')"
          :disabled="demand.status === 'open'"
          @click="emit('edit')"
        >
          <EditIcon aria-hidden="true" />
        </AppButton>
      </div>
      <p v-if="demand.status === 'open'" class="demand-note">{{ t("buy.openHint", { hours: session.policy.demandTtlHours }) }}</p>
      <p v-if="notice" class="error" role="alert">{{ notice }}</p>
    </header>

    <section class="demand-block" :aria-label="t('buy.response')">
      <p class="demand-kicker">{{ t("buy.response") }}</p>
      <div v-for="(reply, index) in demand.replies || []" :key="reply.id || `${reply.kind}-${index}`" class="demand-reply">
        <p class="demand-time">
          <span>{{ timeLabel(reply.createdAt) }}</span>
          <span v-if="reply.kind === 'system'"> · {{ t("buy.system") }}</span>
        </p>
        <p v-if="reply.kind === 'system'" class="demand-text">{{ systemText(reply) }}</p>
        <template v-else>
          <p v-if="reply.category || reply.price != null" class="demand-time">
            <span v-if="reply.category">{{ reply.category }}</span>
            <span v-if="reply.category && reply.price != null"> · </span>
            <span v-if="reply.price != null" :aria-label="t('home.usePrice', { n: reply.price })">{{ reply.price }}</span>
          </p>
          <p v-if="reply.body" class="demand-text">{{ reply.body }}</p>
          <div v-if="shownImages(reply).length" class="information-images" :class="`is-${shownImages(reply).length}`">
            <img v-for="url in shownImages(reply)" :key="url" :src="url" alt="" class="information-photo" />
          </div>
          <ul v-else-if="pendingImages(reply).length" class="demand-files">
            <li v-for="(file, index) in pendingImages(reply)" :key="file.id || `${file.name}-${index}`">
              <span class="demand-file">
                <ImageIcon class="demand-file-icon" aria-hidden="true" />
                <span>{{ file.name || t("home.image") }}</span>
              </span>
            </li>
          </ul>
          <div v-if="shownAudio(reply).length" class="information-audio">
            <template v-for="file in shownAudio(reply)" :key="file.id || file.url || file.name">
              <audio v-if="file.url" :src="file.url" controls :aria-label="file.name || t('home.audio')" />
              <span v-else class="demand-file">
                <AudioIcon class="demand-file-icon" aria-hidden="true" />
                <span>{{ file.name || t("home.audio") }}</span>
              </span>
            </template>
          </div>
          <VideoFrame v-if="shownVideos(reply)[0]" :url="shownVideos(reply)[0].url" :poster="shownVideos(reply)[0].poster || ''" />
          <ul v-if="shownFile(reply).length" class="demand-files">
            <li v-for="(file, index) in shownFile(reply)" :key="file.id || `${file.name}-${index}`">
              <a v-if="file.url" class="demand-file" :href="file.url">
                <PaperclipIcon class="demand-file-icon" aria-hidden="true" />
                <span>{{ file.name || t("buy.file") }}</span>
              </a>
              <span v-else class="demand-file">
                <PaperclipIcon class="demand-file-icon" aria-hidden="true" />
                <span>{{ file.name || t("buy.file") }}</span>
              </span>
            </li>
          </ul>
          <div v-if="reply.starrable || hasPacketFiles(reply)" class="post-actions">
            <button
              v-if="hasPacketFiles(reply)"
              type="button"
              class="post-action"
              :disabled="downloadingId === reply.id"
              :aria-label="t('home.download')"
              @click="onDownload(reply)"
            >
              <DownloadIcon aria-hidden="true" />
              <span>{{ t("home.download") }}</span>
            </button>
            <button
              v-if="reply.starrable"
              type="button"
              class="post-action"
              :class="{ 'is-on': reply.starred }"
              :aria-pressed="Boolean(reply.starred)"
              :aria-label="reply.starred ? t('home.unstar') : t('home.star')"
              @click="emit('star', reply)"
            >
              <StarIcon :filled="Boolean(reply.starred)" aria-hidden="true" />
              <span>{{ reply.starred ? t("home.starred") : t("home.star") }}</span>
            </button>
          </div>
          <p v-if="confirmingId === reply.id && reply.granted === false" class="muted card-notice">{{ t("home.downloadPay", { n: reply.price || 0 }) }}</p>
          <p v-if="reply.notice" class="error card-notice" role="alert">{{ reply.notice }}</p>
        </template>
      </div>
    </section>
  </article>
</template>
