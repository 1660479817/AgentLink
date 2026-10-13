<script setup>
import { computed, ref } from "vue";
import AppButton from "./AppButton.vue";
import { t } from "../i18n/index.js";
import { CloseIcon } from "../icons/index.js";
import { useSessionStore } from "../stores/session";

defineProps({
  bodyId: { type: String, required: true },
  bodyLabel: { type: String, required: true },
  placeholder: { type: String, required: true },
  videoOpen: { type: Boolean, default: false },
  previews: { type: Array, default: () => [] },
  audioName: { type: String, default: "" },
  files: { type: Array, default: () => [] },
  showPrice: { type: Boolean, default: false },
  priceId: { type: String, required: true },
  busy: { type: Boolean, default: false },
});

const body = defineModel("body", { type: String, default: "" });
const video = defineModel("video", { type: String, default: "" });
const price = defineModel("price", { type: String, default: "" });

const emit = defineEmits(["remove-image", "remove-audio", "remove-file"]);

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
      rows="4"
      class="share-input"
      :placeholder="placeholder"
      :disabled="busy"
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
    <p v-else class="share-note">{{ t("home.shareNoFilePrice") }}</p>
    <slot name="after" />
  </div>
</template>
