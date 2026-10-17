<script setup>
import { computed, ref } from "vue";
import AppButton from "./AppButton.vue";
import { t } from "../i18n/index.js";
import { CloseIcon } from "../icons/index.js";
import { useSessionStore } from "../stores/session";

const props = defineProps({
  bodyId: { type: String, required: true },
  bodyLabel: { type: String, required: true },
  placeholder: { type: String, required: true },
  rows: { type: Number, default: 4 },
  grow: { type: Boolean, default: false },
  videoOpen: { type: Boolean, default: false },
  previews: { type: Array, default: () => [] },
  audioName: { type: String, default: "" },
  files: { type: Array, default: () => [] },
  showPrice: { type: Boolean, default: false },
  showFreeNote: { type: Boolean, default: true },
  priceId: { type: String, required: true },
  posterPreview: { type: String, default: "" },
  busy: { type: Boolean, default: false },
});

const body = defineModel("body", { type: String, default: "" });
const video = defineModel("video", { type: String, default: "" });
const price = defineModel("price", { type: String, default: "" });

const emit = defineEmits(["remove-image", "remove-audio", "remove-file", "pick-poster", "remove-poster"]);

const session = useSessionStore();
const bodyInput = ref(null);
const videoInput = ref(null);
const priceLabel = computed(() =>
  t("home.priceLabelRange", {
    min: session.policy.priceMin ?? 0,
    max: session.policy.priceMax ?? 100,
  })
);
const pricePlaceholder = computed(() =>
  t("home.priceBlank", { fallback: session.policy.defaultPrice ?? 10 })
);

function growBody(event) {
  if (!props.grow) return;
  const el = event.target;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

defineExpose({
  focusBody() {
    bodyInput.value?.focus();
  },
  focusVideo() {
    videoInput.value?.focus();
  },
});
</script>

<template>
  <div class="packet-fields">
    <slot name="before" />
    <label class="visually-hidden" :for="bodyId">{{ bodyLabel }}</label>
    <textarea
      :id="bodyId"
      ref="bodyInput"
      v-model="body"
      :rows="rows"
      class="share-input"
      :class="{ 'is-growing': grow }"
      :placeholder="placeholder"
      :disabled="busy"
      @input="growBody"
    />
    <div v-if="previews.length" class="share-photos">
      <div v-for="(url, index) in previews" :key="url" class="share-photo">
        <img :src="url" alt="" />
        <AppButton
          variant="icon"
          type="button"
          class="share-photo-remove"
          :aria-label="t('home.remove')"
          :disabled="busy"
          @click="emit('remove-image', index)"
        >
          <CloseIcon aria-hidden="true" />
        </AppButton>
      </div>
    </div>
    <label v-if="videoOpen || video" class="visually-hidden" :for="`${bodyId}-video`">{{ t("home.shareVideo") }}</label>
    <input
      v-if="videoOpen || video"
      :id="`${bodyId}-video`"
      ref="videoInput"
      v-model="video"
      type="text"
      inputmode="url"
      class="share-video"
      :placeholder="t('home.videoPlaceholder')"
      :disabled="busy"
    />
    <div v-if="videoOpen || video" class="share-poster">
      <AppButton variant="secondary" type="button" :disabled="busy" @click="emit('pick-poster')">
        {{ t("home.posterPick") }}
      </AppButton>
      <span v-if="posterPreview" class="share-poster-thumb">
        <img :src="posterPreview" alt="" />
        <AppButton
          variant="icon"
          type="button"
          :aria-label="t('home.remove')"
          :disabled="busy"
          @click="emit('remove-poster')"
        >
          <CloseIcon aria-hidden="true" />
        </AppButton>
      </span>
    </div>
    <ul v-if="audioName" class="chat-pending share-files">
      <li class="chat-pending-item">
        <span class="chat-file-name share-file-name">{{ audioName }}</span>
        <AppButton variant="secondary" type="button" :disabled="busy" @click="emit('remove-audio')">
          {{ t("home.remove") }}
        </AppButton>
      </li>
    </ul>
    <ul v-if="files.length" class="chat-pending share-files">
      <li v-for="(item, index) in files" :key="`${item.name}-${index}`" class="chat-pending-item">
        <span class="chat-file-name share-file-name">{{ item.name }}</span>
        <AppButton variant="secondary" type="button" :disabled="busy" @click="emit('remove-file', index)">
          {{ t("home.remove") }}
        </AppButton>
      </li>
    </ul>
    <slot name="meta" />
    <div v-if="showPrice" class="share-price-row">
      <label class="share-price-copy" :for="priceId">{{ priceLabel }}</label>
      <input
        :id="priceId"
        v-model="price"
        type="text"
        inputmode="numeric"
        class="share-compact"
        :placeholder="pricePlaceholder"
        :disabled="busy"
      />
    </div>
    <p v-else-if="showFreeNote" class="share-note">{{ t("home.shareNoFilePrice") }}</p>
    <slot name="after" />
  </div>
</template>
