<script setup>
import { computed, nextTick, onUnmounted, ref } from "vue";
import AppButton from "./AppButton.vue";
import { createIntel, uploadImage } from "../api.js";
import { errorText, MAX_IMAGES, readOptionalPrice, requireSession } from "../composers/packet.js";
import { t } from "../i18n/index.js";
import { CameraIcon, CloseIcon, PlusIcon } from "../icons/index.js";
import { useSessionStore } from "../stores/session";

const emit = defineEmits(["close", "done"]);

const session = useSessionStore();
const body = ref("");
const images = ref([]);
const previewUrls = ref([]);
const photoIndex = ref(0);
const price = ref("");
const isPublic = ref(true);
const error = ref("");
const busy = ref(false);
const imageInput = ref(null);
const photoActive = computed(() => {
  const last = previewUrls.value.length - 1;
  if (last < 0) return 0;
  return Math.min(photoIndex.value, last);
});
const canSend = computed(() => images.value.length > 0 || Boolean(body.value.trim()));
const priceLabel = computed(() =>
  t("home.priceLabelRange", {
    min: session.policy.priceMin ?? 0,
    max: session.policy.priceMax ?? 100,
  })
);
const pricePlaceholder = computed(() =>
  t("home.priceBlank", { fallback: session.policy.defaultPrice ?? 10 })
);

function clearPreviews() {
  for (const url of previewUrls.value) URL.revokeObjectURL(url);
  previewUrls.value = [];
}

function syncPreviews() {
  clearPreviews();
  previewUrls.value = images.value.map((file) => URL.createObjectURL(file));
}

function openCamera() {
  if (images.value.length >= MAX_IMAGES) return;
  imageInput.value?.click();
}

function pickPhoto(event) {
  const files = Array.from(event.target.files || []);
  event.target.value = "";
  if (!files.length) return;
  const next = [...images.value, files[0]].slice(0, MAX_IMAGES);
  images.value = next;
  syncPreviews();
  photoIndex.value = next.length - 1;
}

function removePhoto(index) {
  images.value = images.value.filter((_, i) => i !== index);
  syncPreviews();
  if (photoIndex.value > index) photoIndex.value -= 1;
}

onUnmounted(clearPreviews);

async function submit() {
  if (!canSend.value || busy.value) return;
  error.value = "";
  const priced = images.value.length ? readOptionalPrice(price.value, session.policy) : { ok: true, price: undefined };
  if (!priced.ok) {
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
    const extra = { public: isPublic.value };
    if (imageIds.length && priced.price !== undefined) extra.price = priced.price;
    await createIntel(body.value.trim(), imageIds, [], extra);
    emit("done");
  } catch (err) {
    error.value = errorText(err.code, session.policy);
  } finally {
    busy.value = false;
  }
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
        <img v-if="previewUrls.length" :src="previewUrls[photoActive]" alt="" class="intel-photo-frame-img" />
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
            <img :src="url" alt="" />
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
        <p v-else class="share-note">{{ t("home.shareNoFilePrice") }}</p>
        <div class="intel-photo-actions">
          <label class="share-public">
            <input v-model="isPublic" type="checkbox" :disabled="busy" />
            <span>{{ isPublic ? t("home.publicOn") : t("home.publicOff") }}</span>
          </label>
          <label v-if="images.length" class="intel-photo-price" for="intel-photo-price">
            <span>{{ priceLabel }}</span>
            <input id="intel-photo-price" v-model="price" type="text" inputmode="numeric" :placeholder="pricePlaceholder" :disabled="busy" />
          </label>
          <AppButton type="submit" :disabled="busy || !canSend">{{ t("home.send") }}</AppButton>
        </div>
      </div>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </form>
  </section>
</template>
