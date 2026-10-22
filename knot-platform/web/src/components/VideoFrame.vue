<script setup>
import { computed, nextTick, ref, watch } from "vue";
import { t } from "../i18n/index.js";
import { VideoIcon } from "../icons/index.js";
import { videoFrame } from "../packet.js";

const props = defineProps({
  url: { type: String, required: true },
  poster: { type: String, default: "" },
  playUrl: { type: String, default: "" },
  // 同一条记录的正文摘要，给封面和播放器一个可念的名字。
  label: { type: String, default: "" },
});

const frame = computed(() => videoFrame(props.url, props.poster, props.playUrl));
const summary = computed(() => String(props.label || "").trim());
const named = computed(() => summary.value || t("home.video"));
// 没有正文摘要时只说「视频」，别拼成「播放视频：视频」。
const playLabel = computed(() => (summary.value ? t("home.videoPlay", { label: summary.value }) : t("home.video")));
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

watch(
  () => frame.value?.poster || "",
  () => {
    posterOk.value = true;
  },
);
</script>

<template>
  <div v-if="frame" class="information-video">
    <img v-if="cover && !playing" class="information-video-poster" :src="cover" :alt="named" @error="hidePoster" />
    <video
      v-else-if="!playing && frame.kind === 'file'"
      class="information-video-poster"
      :src="`${frame.src}#t=0.1`"
      preload="metadata"
      muted
      playsinline
      aria-hidden="true"
    />
    <button
      v-if="!playing && frame.kind !== 'open'"
      type="button"
      class="information-video-open"
      :aria-label="playLabel"
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
      :title="named"
    >
      <VideoIcon class="information-video-mark" aria-hidden="true" />
      <span class="information-video-external">{{ t("home.videoOpenExternal") }}</span>
    </a>
    <iframe
      v-else-if="frame.kind === 'iframe'"
      :src="frame.src"
      :title="named"
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
      :aria-label="named"
    />
  </div>
</template>
