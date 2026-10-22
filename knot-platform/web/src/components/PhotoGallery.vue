<script setup>
import { ref } from "vue";
import PhotoLightbox from "./PhotoLightbox.vue";
import { t } from "../i18n/index.js";
import { photoAlt } from "../mediaLabel.js";

const props = defineProps({
  photos: { type: Array, default: () => [] },
  // 同一条记录的正文摘要。没有独立替代文本字段，拿它当 alt 的底。
  label: { type: String, default: "" },
});

const open = ref(false);
const index = ref(0);

function openAt(position) {
  index.value = position;
  open.value = true;
}
</script>

<template>
  <div v-if="props.photos.length" class="information-images" :class="`is-${props.photos.length}`">
    <button
      v-for="(url, position) in props.photos"
      :key="position"
      type="button"
      class="information-photo-btn"
      :aria-label="t('home.enlargeImage')"
      @click="openAt(position)"
    >
      <img
        :src="url"
        :alt="photoAlt(t, props.label, position, props.photos.length)"
        class="information-photo"
        loading="lazy"
        decoding="async"
      />
    </button>
  </div>
  <PhotoLightbox :photos="props.photos" :label="props.label" :open="open" :index="index" @close="open = false" />
</template>
