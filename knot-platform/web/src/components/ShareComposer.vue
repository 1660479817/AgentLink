<script setup>
import { computed, nextTick, ref, watch } from "vue";
import AppButton from "./AppButton.vue";
import MentionPicker from "./MentionPicker.vue";
import { ATTACHMENT_ACCEPT, errorText, nameMark, readOptionalPrice, readVideoLink, requireSession, usePacketMedia } from "../composers/packet.js";
import { t } from "../i18n/index.js";
import { AtIcon, AudioIcon, CloseIcon, CoinIcon, ImageIcon, PaperclipIcon, SendIcon, UserIcon, VideoIcon } from "../icons/index.js";
import { packetDraft, useOutboxStore } from "../stores/outbox";
import { useSessionStore } from "../stores/session";

const props = defineProps({
  active: { type: Boolean, default: false },
  focusKind: { type: String, default: "text" },
  focusNonce: { type: Number, default: 0 },
});

const emit = defineEmits(["activate", "close", "done"]);

const session = useSessionStore();
const outbox = useOutboxStore();
const body = ref("");
const mentions = ref([]);
const mentionOpen = ref(false);
const isPublic = ref(false);
const priceFocused = ref(false);
const busy = ref(false);
const bodyInput = ref(null);
const videoInput = ref(null);
const imageInput = ref(null);
const fileInput = ref(null);
const audioInput = ref(null);
const posterInput = ref(null);
const {
  images,
  previewUrls,
  files,
  audio,
  video,
  videoOpen,
  posterFile,
  posterPreview,
  price,
  error,
  hasUpload,
  addImages,
  removeImage,
  addFiles,
  removeFile,
  setAudio,
  removeAudio,
  setPosterFile,
  removePoster,
  reset: resetMedia,
} = usePacketMedia();
const mark = computed(() => nameMark(session.user));
const priceHint = computed(() =>
  priceFocused.value
    ? t("home.priceRange", {
        min: session.policy.priceMin ?? 0,
        max: session.policy.priceMax ?? 100,
      })
    : t("home.priceEmpty")
);
const canSend = computed(() =>
  isPublic.value &&
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
  mentions.value = [];
  mentionOpen.value = false;
  isPublic.value = false;
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
    videoInput.value?.focus();
    return;
  }
  bodyInput.value?.focus();
}

function onBodyFocus() {
  if (!props.active) emit("activate", "text");
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
  else   if (kind === "video") {
    videoOpen.value = true;
    nextTick(() => videoInput.value?.focus());
  }
}

async function pickImages(event) {
  await addImages(Array.from(event.target.files || []));
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

function pickPoster(event) {
  const file = Array.from(event.target.files || [])[0];
  event.target.value = "";
  if (file) setPosterFile(file);
}

function submit() {
  if (!canSend.value || busy.value) return;
  error.value = "";
  const link = readVideoLink(video.value);
  if (link === null) {
    error.value = t("home.badVideo");
    return;
  }
  let videoPayload = null;
  if (link) {
    if (!posterFile.value) {
      error.value = t("home.badPoster");
      return;
    }
    videoPayload = { url: link, posterFile: posterFile.value };
  }
  const priced = files.value.length ? readOptionalPrice(price.value, session.policy) : { ok: true, price: undefined };
  if (files.value.length && !priced.ok) {
    error.value = errorText("bad_price", session.policy);
    return;
  }
  try {
    requireSession(session.user);
  } catch (err) {
    error.value = errorText(err.code, session.policy);
    return;
  }
  const extra = { kind: "post", public: isPublic.value };
  if (files.value.length && priced.price !== undefined) extra.price = priced.price;
  if (mentions.value.length) extra.mentions = mentions.value.map((friend) => friend.id);
  busy.value = true;
  outbox.enqueue(packetDraft({
    body: body.value.trim(),
    images: images.value,
    files: files.value.map((item) => item.file),
    audio: audio.value?.file || null,
    video: videoPayload,
    extra,
    policy: session.policy,
  }));
  emit("done");
}
</script>

<template>
  <section class="card share-bar" :class="{ 'is-open': active }" :aria-label="t('home.sharePrompt')">
    <form id="share-form" @submit.prevent="submit">
      <div class="share-prompt">
        <span class="share-avatar" aria-hidden="true">
          <img v-if="session.user?.avatarUrl" :src="session.user.avatarUrl" alt="" />
          <span v-else-if="mark">{{ mark }}</span>
          <UserIcon v-else />
        </span>
        <label class="visually-hidden" for="share-body">{{ t("home.shareKindPacket") }}</label>
        <input
          id="share-body"
          ref="bodyInput"
          v-model="body"
          type="text"
          class="share-pill-input"
          :placeholder="t('home.sharePrompt')"
          :disabled="busy"
          @focus="onBodyFocus"
        />
      </div>

      <MentionPicker v-model="mentions" v-model:body="body" v-model:open="mentionOpen" :disabled="busy" />

      <div class="share-actions">
        <button
          type="button"
          class="share-action"
          :disabled="busy"
          :aria-expanded="mentionOpen"
          :aria-label="t('home.mention')"
          @click="mentionOpen = !mentionOpen"
        >
          <AtIcon class="share-action-icon share-action-mention" aria-hidden="true" />
          <span>{{ t("home.mention") }}</span>
        </button>
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

      <div v-if="active" class="share-more">
        <div v-if="previewUrls.length" class="share-photos">
          <div v-for="(url, index) in previewUrls" :key="url" class="share-photo">
            <img :src="url" :alt="t('home.image')" />
            <AppButton
              variant="icon"
              type="button"
              class="share-photo-remove"
              :aria-label="t('home.remove')"
              :disabled="busy"
              @click="removeImage(index)"
            >
              <CloseIcon aria-hidden="true" />
            </AppButton>
          </div>
        </div>
        <label v-if="videoOpen || video" class="visually-hidden" for="share-video">{{ t("home.shareVideo") }}</label>
        <input
          v-if="videoOpen || video"
          id="share-video"
          ref="videoInput"
          v-model="video"
          type="text"
          inputmode="url"
          class="share-video"
          :placeholder="t('home.videoPlaceholder')"
          :disabled="busy"
        />
        <div v-if="videoOpen || video" class="share-poster">
          <AppButton variant="secondary" type="button" :disabled="busy" @click="posterInput?.click()">
            {{ t("home.posterPick") }}
          </AppButton>
          <span v-if="posterPreview" class="share-poster-thumb">
            <img :src="posterPreview" :alt="t('home.formVideo')" />
            <AppButton
              variant="icon"
              type="button"
              :aria-label="t('home.remove')"
              :disabled="busy"
              @click="removePoster"
            >
              <CloseIcon aria-hidden="true" />
            </AppButton>
          </span>
        </div>
        <ul v-if="audio" class="chat-pending share-files">
          <li class="chat-pending-item">
            <span class="chat-file-name share-file-name">{{ audio.name }}</span>
            <AppButton variant="secondary" type="button" :disabled="busy" @click="removeAudio">
              {{ t("home.remove") }}
            </AppButton>
          </li>
        </ul>
        <ul v-if="files.length" class="chat-pending share-files">
          <li v-for="(item, index) in files" :key="`${item.name}-${index}`" class="chat-pending-item">
            <span class="chat-file-name share-file-name">{{ item.name }}</span>
            <AppButton variant="secondary" type="button" :disabled="busy" @click="removeFile(index)">
              {{ t("home.remove") }}
            </AppButton>
          </li>
        </ul>
        <div class="share-foot">
          <div class="share-foot-fields">
            <label class="wish-consent share-consent">
              <input v-model="isPublic" type="checkbox" :disabled="busy" />
              <span>{{ t("home.shareConsent") }}</span>
            </label>
            <label v-if="files.length" class="share-coin">
              <CoinIcon class="share-coin-icon" aria-hidden="true" />
              <input
                id="share-price"
                v-model="price"
                type="text"
                inputmode="numeric"
                class="share-coin-input"
                :placeholder="priceHint"
                :aria-label="t('home.priceField')"
                :disabled="busy"
                @focus="priceFocused = true"
                @blur="priceFocused = false"
              />
            </label>
          </div>
          <AppButton
            class="wish-send"
            variant="icon"
            type="submit"
            :aria-label="t('home.send')"
            :disabled="busy || !canSend"
          >
            <SendIcon aria-hidden="true" />
          </AppButton>
        </div>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
      </div>

      <input ref="imageInput" type="file" accept="image/*" multiple class="visually-hidden" @change="pickImages" />
      <input ref="fileInput" type="file" :accept="ATTACHMENT_ACCEPT" multiple class="visually-hidden" @change="pickFiles" />
      <input ref="audioInput" type="file" accept="audio/*" class="visually-hidden" @change="pickAudio" />
      <input ref="posterInput" type="file" accept="image/*" class="visually-hidden" @change="pickPoster" />
    </form>
  </section>
</template>
