<script setup>
import { computed, nextTick, ref, watch } from "vue";
import AppButton from "./AppButton.vue";
import PacketMediaFields from "./PacketMediaFields.vue";
import { createIntel, uploadAttachment, uploadAudio, uploadImage } from "../api.js";
import { errorText, nameMark, readOptionalPrice, readVideoLink, requireSession, usePacketMedia } from "../composers/packet.js";
import { t } from "../i18n/index.js";
import { AudioIcon, CloseIcon, ImageIcon, PaperclipIcon, UserIcon, VideoIcon } from "../icons/index.js";
import { useSessionStore } from "../stores/session";

const props = defineProps({
  active: { type: Boolean, default: false },
  focusKind: { type: String, default: "text" },
  focusNonce: { type: Number, default: 0 },
});

const emit = defineEmits(["activate", "close", "done"]);

const session = useSessionStore();
const body = ref("");
const isPublic = ref(true);
const busy = ref(false);
const fields = ref(null);
const imageInput = ref(null);
const fileInput = ref(null);
const audioInput = ref(null);
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
  reset: resetMedia,
} = usePacketMedia();
const mark = computed(() => nameMark(session.user));
const canSend = computed(() =>
  Boolean(
    body.value.trim() ||
      video.value.trim() ||
      images.value.length ||
      files.value.length ||
      audio.value
  )
);

function resetAll() {
  body.value = "";
  isPublic.value = true;
  busy.value = false;
  resetMedia();
}

async function applyFocus(kind) {
  await nextTick();
  if (kind === "image") {
    imageInput.value?.click();
    return;
  }
  if (kind === "file") {
    fileInput.value?.click();
    return;
  }
  if (kind === "audio") {
    audioInput.value?.click();
    return;
  }
  if (kind === "video") {
    videoOpen.value = true;
    await nextTick();
    fields.value?.focusVideo();
    return;
  }
  fields.value?.focusBody();
}

watch(
  () => [props.active, props.focusNonce],
  async ([active, nonce], prev) => {
    if (!active) {
      if (prev?.[0]) resetAll();
      return;
    }
    const opened = !prev || !prev[0] || prev[1] !== nonce;
    if (opened) await applyFocus(props.focusKind);
  }
);

function onMedia(kind) {
  if (!props.active) {
    emit("activate", kind);
    return;
  }
  if (kind === "image") imageInput.value?.click();
  else if (kind === "file") fileInput.value?.click();
  else if (kind === "audio") audioInput.value?.click();
  else if (kind === "video") {
    videoOpen.value = true;
    nextTick(() => fields.value?.focusVideo());
  }
}

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

async function uploadIds(list, upload) {
  const ids = [];
  for (const file of list) {
    const data = await upload(file);
    ids.push(data.id);
  }
  return ids;
}

async function submit() {
  if (!canSend.value || busy.value) return;
  error.value = "";
  const link = readVideoLink(video.value);
  if (link === null) {
    error.value = t("home.badVideo");
    return;
  }
  if (hasUpload.value && !readOptionalPrice(price.value, session.policy).ok) {
    error.value = errorText("bad_price", session.policy);
    return;
  }
  busy.value = true;
  try {
    requireSession(session.user);
    const link = readVideoLink(video.value);
    const priced = readOptionalPrice(price.value, session.policy);
    const imageIds = await uploadIds(images.value, uploadImage);
    const fileIds = await uploadIds(
      files.value.map((item) => item.file),
      uploadAttachment
    );
    const extra = { public: isPublic.value };
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
  <section class="card share-bar" :aria-label="t('home.sharePrompt')">
    <form v-if="active" id="share-form" class="share-dialog" @submit.prevent="submit">
      <div class="share-dialog-head">
        <p class="share-dialog-title">{{ t("home.shareKindPacket") }}</p>
        <AppButton variant="icon" plain type="button" :aria-label="t('home.dismiss')" :disabled="busy" @click="emit('close')">
          <CloseIcon class="share-close-icon" aria-hidden="true" />
        </AppButton>
      </div>

      <PacketMediaFields
        ref="fields"
        v-model:body="body"
        v-model:video="video"
        v-model:price="price"
        body-id="share-body"
        :body-label="t('home.shareKindPacket')"
        :placeholder="t('home.sharePacketPlaceholder')"
        :video-open="videoOpen"
        :previews="previewUrls"
        :audio-name="audio?.name || ''"
        :files="files"
        :show-price="hasUpload"
        :show-free-note="true"
        price-id="share-price"
        :busy="busy"
        @remove-image="removeImage"
        @remove-audio="removeAudio"
        @remove-file="removeFile"
      >
        <template #meta>
          <label class="share-switch-row">
            <span class="share-switch-copy">
              <span class="share-switch-title">{{ isPublic ? t("home.publicOn") : t("home.publicOff") }}</span>
              <span class="share-switch-hint">{{ isPublic ? t("home.sharePublicHint") : t("home.sharePrivateHint") }}</span>
            </span>
            <input v-model="isPublic" type="checkbox" :disabled="busy" />
          </label>
        </template>
      </PacketMediaFields>
    </form>

    <button v-else type="button" class="share-prompt" @click="emit('activate', 'text')">
      <span class="share-avatar" aria-hidden="true">
        <img v-if="session.user?.avatarUrl" :src="session.user.avatarUrl" alt="" />
        <span v-else-if="mark">{{ mark }}</span>
        <UserIcon v-else />
      </span>
      <span class="share-pill">{{ t("home.sharePrompt") }}</span>
    </button>

    <div class="share-actions">
      <button type="button" class="share-action" :disabled="busy" @click="onMedia('image')">
        <ImageIcon class="share-action-icon share-action-image" aria-hidden="true" />
        <span>{{ t("home.shareImage") }}</span>
      </button>
      <button type="button" class="share-action" :disabled="busy" @click="onMedia('video')">
        <VideoIcon class="share-action-icon share-action-video" aria-hidden="true" />
        <span>{{ t("home.shareVideo") }}</span>
      </button>
      <button type="button" class="share-action" :disabled="busy" @click="onMedia('audio')">
        <AudioIcon class="share-action-icon share-action-audio" aria-hidden="true" />
        <span>{{ t("home.shareAudio") }}</span>
      </button>
      <button type="button" class="share-action" :disabled="busy" @click="onMedia('file')">
        <PaperclipIcon class="share-action-icon share-action-file" aria-hidden="true" />
        <span>{{ t("home.shareFile") }}</span>
      </button>
    </div>

    <div v-if="active" class="share-submit">
      <AppButton type="submit" form="share-form" :disabled="busy || !canSend">
        {{ t("home.send") }}
      </AppButton>
    </div>
    <p v-if="active && error" class="error" role="alert">{{ error }}</p>

    <input ref="imageInput" type="file" accept="image/*" multiple class="visually-hidden" @change="pickImages" />
    <input ref="fileInput" type="file" multiple class="visually-hidden" @change="pickFiles" />
    <input ref="audioInput" type="file" accept="audio/*" class="visually-hidden" @change="pickAudio" />
  </section>
</template>
