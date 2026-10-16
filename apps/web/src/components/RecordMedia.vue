<script setup>
import { computed } from "vue";
import { t } from "../i18n/index.js";
import { AudioIcon } from "../icons/index.js";
import { packetAudio, photoUrls } from "../packet.js";

const props = defineProps({
  images: { type: Array, default: () => [] },
  audio: { type: Array, default: () => [] },
});

const photos = computed(() => photoUrls([], props.images));
const clips = computed(() => packetAudio(props.audio));
</script>

<template>
  <div v-if="photos.length" class="information-images" :class="`is-${photos.length}`">
    <img v-for="url in photos" :key="url" :src="url" alt="" class="information-photo" loading="lazy" decoding="async" />
  </div>
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
