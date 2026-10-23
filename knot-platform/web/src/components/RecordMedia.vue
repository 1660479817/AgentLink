<script setup>
import { computed } from "vue";
import { t } from "../i18n/index.js";
import { AudioIcon } from "../icons/index.js";
import PhotoGallery from "./PhotoGallery.vue";
import { packetAudio, photoItems } from "../packet.js";

const props = defineProps({
  images: { type: Array, default: () => [] },
  audio: { type: Array, default: () => [] },
  // 这条记录的正文摘要，透传给图片的 alt。
  label: { type: String, default: "" },
});

const photos = computed(() => photoItems(props.images));
const clips = computed(() => packetAudio(props.audio));
</script>

<template>
  <PhotoGallery :photos="photos" :label="label" />
  <div v-if="clips.length" class="information-audio">
    <template v-for="file in clips" :key="file.id || file.url || file.name">
      <audio v-if="file.url" :src="file.url" controls :aria-label="file.name || t('home.audio')" />
      <span v-else class="information-file">
        <AudioIcon class="information-file-icon" aria-hidden="true" />
        <span>{{ file.name || t("home.audio") }}</span>
      </span>
    </template>
  </div>
</template>
