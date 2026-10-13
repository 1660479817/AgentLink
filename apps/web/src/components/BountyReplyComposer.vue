<script setup>
import { computed, onMounted, ref, watch } from "vue";
import AppButton from "./AppButton.vue";
import PacketMediaFields from "./PacketMediaFields.vue";
import VideoFrame from "./VideoFrame.vue";
import { createIntel, downloadInformation, listBountyResponses, uploadAttachment, uploadAudio, uploadImage } from "../api.js";
import { errorText, readOptionalPrice, readVideoLink, requireSession, usePacketMedia } from "../composers/packet.js";
import { t } from "../i18n/index.js";
import { AudioIcon, CloseIcon, ImageIcon, PaperclipIcon, VideoIcon } from "../icons/index.js";
import { useSessionStore } from "../stores/session";

const props = defineProps({
  bounty: { type: Object, required: true },
});

const emit = defineEmits(["close", "done"]);

const session = useSessionStore();
const responses = ref([]);
const busy = ref(false);
const imageInput = ref(null);
const fileInput = ref(null);
const audioInput = ref(null);
const body = ref("");
const {
  images,
  previewUrls,
  files,
  audio,
  video,
  videoOpen,
  price,
  error,
  hasUpload,
  addImages,
  removeImage,
  addFiles,
  removeFile,
  setAudio,
  removeAudio,
} = usePacketMedia();
const mine = computed(() => Boolean(props.bounty.mine));
const canSend = computed(() =>
  Boolean(video.value.trim() || images.value.length || files.value.length || audio.value || body.value.trim())
);

function when(value) {
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return "";
  const minutes = Math.floor((Date.now() - then) / 60000);
  if (minutes < 1) return t("home.justNow");
  if (minutes < 60) return t("home.minutesAgo", { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("home.hoursAgo", { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t("home.daysAgo", { n: days });
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
  }).formatToParts(new Date(then));
  const month = parts.find((part) => part.type === "month")?.value || "";
  const day = parts.find((part) => part.type === "day")?.value || "";
  return t("home.postedOn", { month, day });
}

async function load() {
  if (!mine.value) {
    responses.value = [];
    return;
  }
  error.value = "";
  try {
    const data = await listBountyResponses(props.bounty.id);
    responses.value = data.responses || [];
  } catch (err) {
    error.value = errorText(err.code, session.policy);
  }
}

onMounted(load);
watch(() => props.bounty.id, load);

function pickImages(event) {
  addImages(Array.from(event.target.files || []));
  event.target.value = "";
}

function pickFiles(event) {
  addFiles(Array.from(event.target.files || []));
  event.target.value = "";
}

function pickAudio(event) {
  const file = Array.from(event.target.files || [])[0];
  event.target.value = "";
  if (file) setAudio(file);
}

async function downloadReply(item) {
  if (item.downloading) return;
  item.downloading = true;
  error.value = "";
  try {
    requireSession(session.user);
    await downloadInformation(item.id);
    await load();
    if (session.user) await session.load();
  } catch (err) {
    error.value = errorText(err.code, session.policy);
  } finally {
    item.downloading = false;
  }
}

async function submit() {
  if (!canSend.value || busy.value || mine.value) return;
  error.value = "";
  const link = readVideoLink(video.value);
  if (link === null) {
    error.value = t("home.badVideo");
    return;
  }
  const priced = readOptionalPrice(price.value, session.policy);
  if (hasUpload.value && !priced.ok) {
    error.value = errorText("bad_price", session.policy);
    return;
  }
  busy.value = true;
  try {
    requireSession(session.user);
    const imageIds = [];
    for (const file of images.value) {
      const data = await uploadImage(file);
      imageIds.push(data.id);
    }
    const fileIds = [];
    for (const item of files.value) {
      const uploaded = await uploadAttachment(item.file);
      fileIds.push(uploaded.id);
    }
    const extra = { bountyId: props.bounty.id };
    if (audio.value) {
      const uploaded = await uploadAudio(audio.value.file);
      extra.audioIds = [uploaded.id];
    }
    if (hasUpload.value && priced.price !== undefined) extra.price = priced.price;
    if (link) extra.videos = [link];
    await createIntel(body.value.trim(), imageIds, fileIds, extra);
    emit("done");
  } catch (err) {
    error.value = errorText(err.code, session.policy);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="card composer" :aria-label="mine ? t('home.bountyReplies') : t('home.bountyReplyTitle')">
    <div class="composer-head">
      <p class="share-dialog-title">{{ mine ? t("home.bountyReplies") : t("home.bountyReplyTitle") }}</p>
      <AppButton variant="icon" plain type="button" :aria-label="t('home.dismiss')" :disabled="busy" @click="emit('close')">
        <CloseIcon class="share-close-icon" aria-hidden="true" />
      </AppButton>
    </div>
    <p class="composer-context-body">{{ bounty.body }}</p>

    <div v-if="mine">
      <p v-if="!responses.length && !error" class="muted">{{ t("home.bountyRepliesEmpty") }}</p>
      <ul v-else class="bounty-reply-list">
        <li v-for="item in responses" :key="item.id" class="bounty-reply">
          <p class="bounty-reply-meta">
            <span>{{ item.author?.name || t("home.author") }}</span>
            <span v-if="when(item.createdAt)"> · {{ when(item.createdAt) }}</span>
          </p>
          <p v-if="item.body" class="bounty-reply-body">{{ item.body }}</p>
          <p v-if="item.fileNames?.length" class="bounty-reply-files">{{ item.fileNames.join("、") }}</p>
          <VideoFrame v-if="item.videos?.[0]" :url="item.videos[0].url" :poster="item.videos[0].poster || ''" />
          <AppButton
            v-if="item.fileNames?.length"
            variant="secondary"
            type="button"
            :disabled="item.downloading"
            @click="downloadReply(item)"
          >
            {{ item.price > 0 && !item.granted ? t("home.downloadPay", { n: item.price }) : t("home.download") }}
          </AppButton>
        </li>
      </ul>
    </div>

    <form v-else id="bounty-reply-form" @submit.prevent="submit">
      <PacketMediaFields
        v-model:body="body"
        v-model:video="video"
        v-model:price="price"
        body-id="bounty-reply-body"
        :body-label="t('home.bountySubmit')"
        :placeholder="t('home.intelPlaceholder')"
        :video-open="videoOpen"
        :previews="previewUrls"
        :audio-name="audio?.name || ''"
        :files="files"
        :show-price="hasUpload"
        price-id="bounty-reply-price"
        :busy="busy"
        @remove-image="removeImage"
        @remove-audio="removeAudio"
        @remove-file="removeFile"
      >
        <template #before>
          <p class="bounty-reply-note">{{ t("home.bountyReplyNote") }}</p>
        </template>
      </PacketMediaFields>
      <div class="share-actions">
        <button type="button" class="share-action" :disabled="busy" @click="imageInput?.click()">
          <ImageIcon class="share-action-icon share-action-image" aria-hidden="true" />
          <span>{{ t("home.shareImage") }}</span>
        </button>
        <button type="button" class="share-action" :disabled="busy" @click="videoOpen = true">
          <VideoIcon class="share-action-icon share-action-video" aria-hidden="true" />
          <span>{{ t("home.shareVideo") }}</span>
        </button>
        <button type="button" class="share-action" :disabled="busy" @click="audioInput?.click()">
          <AudioIcon class="share-action-icon share-action-audio" aria-hidden="true" />
          <span>{{ t("home.shareAudio") }}</span>
        </button>
        <button type="button" class="share-action" :disabled="busy" @click="fileInput?.click()">
          <PaperclipIcon class="share-action-icon share-action-file" aria-hidden="true" />
          <span>{{ t("home.shareFile") }}</span>
        </button>
      </div>
      <div class="share-submit">
        <AppButton type="submit" :disabled="busy || !canSend">{{ t("home.bountySubmit") }}</AppButton>
      </div>
      <input ref="imageInput" type="file" accept="image/*" multiple class="visually-hidden" @change="pickImages" />
      <input ref="fileInput" type="file" multiple class="visually-hidden" @change="pickFiles" />
      <input ref="audioInput" type="file" accept="audio/*" class="visually-hidden" @change="pickAudio" />
    </form>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </section>
</template>
