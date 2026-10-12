<script setup>
import AppButton from "./AppButton.vue";
import { t } from "../i18n/index.js";
import { DownloadIcon, EditIcon, PaperclipIcon, StarIcon, StopIcon } from "../icons/index.js";

defineProps({
  demand: { type: Object, required: true },
  stopping: { type: Boolean, default: false },
  notice: { type: String, default: "" },
});

const emit = defineEmits(["stop", "edit", "star", "download"]);

function namedFiles(reply) {
  return [...(reply.images || []), ...(reply.attachments || [])].filter((file) => !file.url);
}

function linkedFiles(reply) {
  return (reply.attachments || []).filter((file) => file.url && !file.image);
}

function shownImages(reply) {
  return (reply.images || []).filter((file) => file.url);
}

function canDownload(reply) {
  return reply.granted === false && ((reply.images || []).length || (reply.attachments || []).length);
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
  if (reply.code === "timeout") return t("buy.systemTimeout");
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
      <p v-if="demand.status === 'open'" class="demand-note">{{ t("buy.openHint") }}</p>
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
          <div v-if="shownImages(reply).length" class="demand-photos">
            <img v-for="file in shownImages(reply)" :key="file.id" :src="file.url" alt="" class="demand-photo" />
          </div>
          <ul v-if="namedFiles(reply).length || linkedFiles(reply).length" class="demand-files">
            <li v-for="file in namedFiles(reply)" :key="`name-${file.id}`">
              <span class="demand-file">
                <PaperclipIcon class="demand-file-icon" aria-hidden="true" />
                <span>{{ file.name || t("buy.file") }}</span>
              </span>
            </li>
            <li v-for="file in linkedFiles(reply)" :key="file.id">
              <a class="demand-file" :href="file.url">
                <PaperclipIcon class="demand-file-icon" aria-hidden="true" />
                <span>{{ file.name || t("buy.file") }}</span>
              </a>
            </li>
          </ul>
          <div v-if="reply.starrable || canDownload(reply)" class="post-actions">
            <button
              v-if="canDownload(reply)"
              type="button"
              class="post-action"
              :aria-label="t('home.download')"
              @click="emit('download', reply)"
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
          <p v-if="reply.notice" class="error card-notice" role="alert">{{ reply.notice }}</p>
        </template>
      </div>
    </section>
  </article>
</template>
