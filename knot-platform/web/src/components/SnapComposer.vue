<script setup>
import { computed, nextTick, ref } from "vue";
import AppButton from "./AppButton.vue";
import MentionPicker from "./MentionPicker.vue";
import { MAX_IMAGES, errorText, requireSession, usePacketMedia } from "../composers/packet.js";
import { t } from "../i18n/index.js";
import { AtIcon, CameraIcon, CloseIcon, PlusIcon } from "../icons/index.js";
import { packetDraft, useOutboxStore } from "../stores/outbox";
import { useSessionStore } from "../stores/session";

const emit = defineEmits(["close", "done"]);

const session = useSessionStore();
const outbox = useOutboxStore();
const body = ref("");
const mentions = ref([]);
const mentionOpen = ref(false);
// 预览图的生命周期与数量/体积上限都交给 usePacketMedia：快拍和分享条用的是同一套规则，
// 两处各写一份的话改一处就会两边筛得不一样。
const { images, previewUrls, error, addImages, removeImage } = usePacketMedia();
const photoIndex = ref(0);
const isPublic = ref(true);
const busy = ref(false);
const imageInput = ref(null);
const photoActive = computed(() => {
  const last = previewUrls.value.length - 1;
  if (last < 0) return 0;
  return Math.min(photoIndex.value, last);
});
const canSend = computed(() => images.value.length > 0 || Boolean(body.value.trim()));

function openCamera() {
  if (images.value.length >= MAX_IMAGES) return;
  imageInput.value?.click();
}

function pickPhoto(event) {
  const files = Array.from(event.target.files || []);
  event.target.value = "";
  if (!files.length) return;
  addImages([files[0]]);
  photoIndex.value = Math.max(0, images.value.length - 1);
}

function removePhoto(index) {
  removeImage(index);
  if (photoIndex.value > index) photoIndex.value -= 1;
}

function submit() {
  if (!canSend.value || busy.value) return;
  error.value = "";
  try {
    requireSession(session.user);
  } catch (err) {
    error.value = errorText(err.code, session.policy);
    return;
  }
  const extra = { kind: "fastpost", public: isPublic.value };
  if (mentions.value.length) extra.mentions = mentions.value.map((friend) => friend.id);
  busy.value = true;
  outbox.enqueue(packetDraft({
    body: body.value.trim(),
    images: images.value,
    extra,
    policy: session.policy,
  }));
  emit("done");
}

nextTick(openCamera);
</script>

<template>
  <section class="card composer intel-compose is-photo" :aria-label="t('home.storyCreate')">
    <form class="composer-dialog intel-photo-form" @submit.prevent="submit">
      <input
        ref="imageInput"
        type="file"
        accept="image/*"
        capture="environment"
        class="visually-hidden"
        @change="pickPhoto"
      />
      <div class="intel-photo-frame" :class="{ 'has-photo': previewUrls.length }">
        <img v-if="previewUrls.length" :src="previewUrls[photoActive]" :alt="t('home.image')" class="intel-photo-frame-img" />
        <button v-else type="button" class="intel-photo-empty" :disabled="busy" @click="openCamera">
          <CameraIcon class="intel-camera-icon" aria-hidden="true" />
          <span>{{ t("home.intelCapture") }}</span>
        </button>
        <AppButton
          variant="icon"
          type="button"
          class="intel-photo-close"
          :disabled="busy"
          :aria-label="t('home.dismiss')"
          @click="emit('close')"
        >
          <CloseIcon aria-hidden="true" />
        </AppButton>
        <AppButton
          v-if="previewUrls.length"
          variant="icon"
          type="button"
          class="intel-photo-remove"
          :disabled="busy"
          :aria-label="t('home.remove')"
          @click="removePhoto(photoActive)"
        >
          <CloseIcon aria-hidden="true" />
        </AppButton>
        <div v-if="previewUrls.length" class="intel-photo-caption">
          <label class="visually-hidden" for="intel-photo-caption">{{ t("home.intelPhotoCaption") }}</label>
          <input id="intel-photo-caption" v-model="body" type="text" :placeholder="t('home.intelPhotoCaption')" :disabled="busy" />
        </div>
      </div>
      <div v-if="!previewUrls.length" class="intel-photo-draft">
        <label class="visually-hidden" for="intel-photo-caption-draft">{{ t("home.intelPhotoCaption") }}</label>
        <input
          id="intel-photo-caption-draft"
          v-model="body"
          type="text"
          :placeholder="t('home.intelPhotoCaption')"
          :disabled="busy"
        />
      </div>
      <MentionPicker v-model="mentions" v-model:body="body" v-model:open="mentionOpen" :disabled="busy" />
      <div class="intel-photo-bar">
        <div v-if="previewUrls.length" class="intel-photo-strip" :aria-label="t('home.intelCapture')">
          <button
            v-for="(url, index) in previewUrls"
            :key="url"
            type="button"
            class="intel-photo-thumb"
            :class="{ 'is-active': index === photoActive }"
            :aria-pressed="index === photoActive"
            :aria-label="t('home.storyPhotoNth', { n: index + 1 })"
            :disabled="busy"
            @click="photoIndex = index"
          >
            <img :src="url" :alt="t('home.image')" />
          </button>
          <AppButton
            v-if="images.length < MAX_IMAGES"
            variant="icon"
            type="button"
            :disabled="busy"
            :aria-label="t('home.intelAddPhoto')"
            @click="openCamera"
          >
            <PlusIcon aria-hidden="true" />
          </AppButton>
          <span class="intel-photo-count">{{ t("home.storyPhotoCount", { n: previewUrls.length, max: MAX_IMAGES }) }}</span>
        </div>
        <div class="intel-photo-actions">
          <label class="share-public">
            <input v-model="isPublic" type="checkbox" :disabled="busy" />
            <span>{{ isPublic ? t("home.publicOn") : t("home.publicOff") }}</span>
          </label>
          <button
            type="button"
            class="mention-trigger"
            :disabled="busy"
            :aria-expanded="mentionOpen"
            :aria-label="t('home.mention')"
            @click="mentionOpen = !mentionOpen"
          >
            <AtIcon aria-hidden="true" />
            <span>{{ t("home.mention") }}</span>
          </button>
          <AppButton type="submit" :disabled="busy || !canSend">{{ t("home.send") }}</AppButton>
        </div>
      </div>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </form>
  </section>
</template>
