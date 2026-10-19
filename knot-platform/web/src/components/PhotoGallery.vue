<script setup>
import { ref } from "vue";
import PhotoLightbox from "./PhotoLightbox.vue";
import { t } from "../i18n/index.js";

const props = defineProps({
  photos: { type: Array, default: () => [] },
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
      <img :src="url" alt="" class="information-photo" loading="lazy" decoding="async" />
    </button>
  </div>
  <PhotoLightbox :photos="props.photos" :open="open" :index="index" @close="open = false" />
</template>
