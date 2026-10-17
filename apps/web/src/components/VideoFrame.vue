<script setup>
import { computed, nextTick, ref } from "vue";
import { t } from "../i18n/index.js";
import { VideoIcon } from "../icons/index.js";
import { videoFrame } from "../packet.js";

const props = defineProps({
  url: { type: String, required: true },
  poster: { type: String, default: "" },
  playUrl: { type: String, default: "" },
});

const frame = computed(() => videoFrame(props.url, props.poster, props.playUrl));
const playing = ref(false);
const posterOk = ref(true);
const player = ref(null);

const cover = computed(() => (posterOk.value ? frame.value?.poster || "" : ""));

async function start() {
  playing.value = true;
  await nextTick();
  player.value?.play?.().catch(() => {});
}

function hidePoster() {
  posterOk.value = false;
}
</script>

<template>
  <div v-if="frame" class="information-video" :class="{ 'has-poster': Boolean(cover) && !playing }">
    <img v-if="cover && !playing" class="information-video-poster" :src="cover" alt="" @error="hidePoster" />
    <button
      v-if="!playing && frame.kind !== 'open'"
      type="button"
      class="information-video-open"
      :aria-label="t('home.video')"
      @click="start"
    >
      <VideoIcon class="information-video-mark" aria-hidden="true" />
    </button>
    <a
      v-else-if="!playing"
      class="information-video-open is-external"
      :href="frame.src"
      target="_blank"
      rel="noopener noreferrer"
      :aria-label="t('home.videoOpenExternal')"
      :title="t('home.videoOpenExternal')"
    >
      <VideoIcon class="information-video-mark" aria-hidden="true" />
      <span class="information-video-external">{{ t("home.videoOpenExternal") }}</span>
    </a>
    <iframe
      v-else-if="frame.kind === 'iframe'"
      :src="frame.src"
      :title="t('home.video')"
      allow="fullscreen; picture-in-picture"
      allowfullscreen
      referrerpolicy="strict-origin-when-cross-origin"
    />
    <video
      v-else-if="frame.kind === 'file'"
      ref="player"
      :src="frame.src"
      :poster="cover"
      controls
      playsinline
      autoplay
      :aria-label="t('home.video')"
    />
  </div>
</template>
