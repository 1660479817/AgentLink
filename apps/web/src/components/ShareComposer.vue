<script setup>
import { computed, nextTick, ref, watch } from "vue";
import AppButton from "./AppButton.vue";
import PacketMediaFields from "./PacketMediaFields.vue";
import { createBounty, createIntel, uploadAttachment, uploadAudio, uploadImage } from "../api.js";
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
const mode = ref("packet");
const body = ref("");
const bountyBody = ref("");
const bountyHours = ref(defaultHours());
const isPublic = ref(true);
const busy = ref(false);
const fields = ref(null);
const bountyInput = ref(null);
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
const canSend = computed(() => {
  if (mode.value === "bounty") return Boolean(bountyBody.value.trim());
  return Boolean(
    body.value.trim() ||
      video.value.trim() ||
      images.value.length ||
      files.value.length ||
      audio.value
  );
});

function defaultHours() {
  return String(Math.min(24, session.policy.bountyMaxHours || 72));
}

function resetAll() {
  mode.value = "packet";
  body.value = "";
  bountyBody.value = "";
  bountyHours.value = defaultHours();
  isPublic.value = true;
  busy.value = false;
  resetMedia();
}

async function applyFocus(kind) {
  mode.value = "packet";
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

async function setMode(next) {
  mode.value = next;
  await nextTick();
  if (!props.active) return;
  if (next === "bounty") bountyInput.value?.focus();
  else fields.value?.focusBody();
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

function onKindKey(event) {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  setMode(mode.value === "packet" ? "bounty" : "packet");
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
  if (mode.value === "bounty") {
    const hours = Number(String(bountyHours.value).trim());
    const max = session.policy.bountyMaxHours || 72;
    if (!Number.isInteger(hours) || hours < 1 || hours > max) {
      error.value = errorText("bad_hours", session.policy);
      return;
    }
  } else {
    const link = readVideoLink(video.value);
    if (link === null) {
      error.value = t("home.badVideo");
      return;
    }
    if (hasUpload.value && !readOptionalPrice(price.value, session.policy).ok) {
      error.value = errorText("bad_price", session.policy);
      return;
    }
  }
  busy.value = true;
  try {
    requireSession(session.user);
    if (mode.value === "bounty") {
      await createBounty(bountyBody.value.trim(), Number(String(bountyHours.value).trim()));
    } else {
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
    }
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
        <p class="share-dialog-title">{{ mode === "bounty" ? t("home.shareKindBounty") : t("home.shareKindPacket") }}</p>
        <AppButton variant="icon" plain type="button" :aria-label="t('home.dismiss')" :disabled="busy" @click="emit('close')">
          <CloseIcon class="share-close-icon" aria-hidden="true" />
        </AppButton>
      </div>
      <div class="share-kinds" role="tablist" :aria-label="t('home.shareKind')">
        <button
          type="button"
          class="share-kind"
          role="tab"
          :aria-selected="mode === 'packet'"
          :disabled="busy"
          @click="setMode('packet')"
          @keydown="onKindKey"
        >
          {{ t("home.shareKindPacket") }}
        </button>
        <button
          type="button"
          class="share-kind"
          role="tab"
          :aria-selected="mode === 'bounty'"
          :disabled="busy"
          @click="setMode('bounty')"
          @keydown="onKindKey"
        >
          {{ t("home.shareKindBounty") }}
        </button>
      </div>

      <PacketMediaFields
        v-if="mode === 'packet'"
        ref="fields"
        v-model:body="body"
        v-model:video="video"
        v-model:price="price"
        body-id="share-body"
        :body-label="t('home.shareKindPacket')"
        :placeholder="t('home.sharePacketPlaceholder')"
        role="tabpanel"
        :video-open="videoOpen"
        :previews="previewUrls"
        :audio-name="audio?.name || ''"
        :files="files"
        :show-price="hasUpload"
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

      <div v-else role="tabpanel">
        <label class="visually-hidden" for="share-bounty-body">{{ t("home.shareKindBounty") }}</label>
        <textarea
          id="share-bounty-body"
          ref="bountyInput"
          v-model="bountyBody"
          rows="4"
          class="share-input"
          :placeholder="t('home.bountyPlaceholder')"
          :disabled="busy"
        />
        <div class="share-hours-row">
          <label for="share-bounty-hours">{{ t("home.bountyHoursLabel") }}</label>
          <input
            id="share-bounty-hours"
            v-model="bountyHours"
            type="text"
            inputmode="numeric"
            class="share-compact"
            :placeholder="t('home.bountyHoursField', { max: session.policy.bountyMaxHours })"
            :disabled="busy"
          />
        </div>
        <p class="share-note">
          {{
            t("home.shareBountyNote", {
              listing: session.policy.listingFee ?? 1,
              completion: session.policy.completionFee ?? 1,
            })
          }}
        </p>
      </div>
    </form>

    <button v-else type="button" class="share-prompt" @click="emit('activate', 'text')">
      <span class="share-avatar" aria-hidden="true">
        <img v-if="session.user?.avatarUrl" :src="session.user.avatarUrl" alt="" />
        <span v-else-if="mark">{{ mark }}</span>
        <UserIcon v-else />
      </span>
      <span class="share-pill">{{ t("home.sharePrompt") }}</span>
    </button>

    <div v-if="!active || mode === 'packet'" class="share-actions">
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
        {{ mode === "bounty" ? t("home.openBounty") : t("home.send") }}
      </AppButton>
    </div>
    <p v-if="active && error" class="error" role="alert">{{ error }}</p>

    <input ref="imageInput" type="file" accept="image/*" multiple class="visually-hidden" @change="pickImages" />
    <input ref="fileInput" type="file" multiple class="visually-hidden" @change="pickFiles" />
    <input ref="audioInput" type="file" accept="audio/*" class="visually-hidden" @change="pickAudio" />
  </section>
</template>
