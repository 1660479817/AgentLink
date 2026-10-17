<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import ActorMark from "./ActorMark.vue";
import AppButton from "./AppButton.vue";
import VideoFrame from "./VideoFrame.vue";
import { t } from "../i18n/index.js";
import { AudioIcon, CloseIcon, CoinIcon, DownloadIcon, FriendAddIcon, FriendCheckIcon, FriendRemoveIcon, ImageIcon, LikeIcon, PaperclipIcon, RemovedIcon, ShareIcon, StarIcon, UserIcon } from "../icons/index.js";
import { isMarkdown, plainMarkdown, renderMarkdown } from "../markdown.js";
import { lockedImages, packetAudio, packetFile, packetForm, packetVideos, photoUrls } from "../packet.js";

const props = defineProps({
  body: { type: String, default: "" },
  category: { type: String, default: "" },
  topics: { type: Array, default: () => [] },
  categorySelected: { type: Boolean, default: false },
  activeTopic: { type: String, default: "" },
  language: { type: String, default: "" },
  price: { type: Number, default: 0 },
  granted: { type: Boolean, default: true },
  images: { type: Array, default: () => [] },
  audio: { type: Array, default: () => [] },
  videos: { type: Array, default: () => [] },
  attachments: { type: Array, default: () => [] },
  note: { type: String, default: "" },
  verdict: { type: String, default: "" },
  authorId: { type: String, default: "" },
  authorName: { type: String, default: "" },
  avatarUrl: { type: String, default: "" },
  authorSelected: { type: Boolean, default: false },
  actor: { type: String, default: "" },
  createdAt: { type: String, default: "" },
  starred: { type: Boolean, default: false },
  canStar: { type: Boolean, default: true },
  liked: { type: Boolean, default: false },
  canLike: { type: Boolean, default: true },
  friend: { type: Boolean, default: false },
  canFriend: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
  sharing: { type: Boolean, default: false },
  notice: { type: String, default: "" },
  canClose: { type: Boolean, default: false },
  closing: { type: Boolean, default: false },
});

const emit = defineEmits(["author", "category", "topic", "dismiss", "star", "like", "download", "friend", "share", "close"]);

function onAuthor() {
  if (!props.authorId) return;
  emit("author");
}

function onCategory() {
  if (!props.category) return;
  emit("category");
}

function onTopic(topic) {
  if (!topic) return;
  emit("topic", topic);
}

const photos = computed(() => photoUrls(props.images));
const pendingImages = computed(() => lockedImages(props.images));
const clips = computed(() => packetAudio(props.audio));
const links = computed(() => packetVideos(props.videos));
const files = computed(() => packetFile(props.attachments));
const form = computed(() => packetForm({ images: props.images, videos: props.videos }));
const formLabel = computed(() => ({ text: "home.formText", image: "home.formImage", video: "home.formVideo" }[form.value]));
const markdown = computed(() => isMarkdown(props.body));
const bodyPlain = computed(() => (markdown.value ? plainMarkdown(props.body) : props.body));
const bodyHtml = computed(() => (markdown.value ? renderMarkdown(props.body) : ""));
const fileNote = computed(() => {
  const note = String(props.note || "").trim();
  if (note) return note;
  if (props.verdict === "pending") return t("home.filePrechecked");
  return "";
});
const hasDownload = computed(() => files.value.length > 0);

function onDownload() {
  if (props.busy) return;
  emit("download");
}

const posted = computed(() => postedLabel(props.createdAt));

function postedLabel(value) {
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return "";
  const minutes = Math.floor((Date.now() - then) / 60000);
  if (minutes < 1) return t("home.justNow");
  if (minutes < 60) return t("home.minutesAgo", { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("home.hoursAgo", { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t("home.daysAgo", { n: days });
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
  }).formatToParts(new Date(then));
  const month = parts.find((part) => part.type === "month")?.value || "";
  const day = parts.find((part) => part.type === "day")?.value || "";
  return t("home.postedOn", { month, day });
}

const bodyRef = ref(null);
const bodyOpen = ref(false);
const bodyClipped = ref(false);

function measureBody() {
  const el = bodyRef.value;
  if (!el || bodyOpen.value) return;
  bodyClipped.value = el.scrollHeight > el.clientHeight + 1;
}

function toggleBody() {
  bodyOpen.value = !bodyOpen.value;
  nextTick(measureBody);
}

onMounted(() => {
  measureBody();
  window.addEventListener("resize", measureBody);
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", measureBody);
});

watch(
  () => props.body,
  () => {
    bodyOpen.value = false;
    nextTick(measureBody);
  },
);
</script>

<template>
  <article class="card post information-card">
    <header class="information-head">
      <div class="information-author">
        <button
          type="button"
          class="information-avatar"
          :aria-label="t('home.openAuthor', { name: authorName || t('home.author') })"
          :aria-pressed="authorSelected"
          @click="onAuthor"
        >
          <img v-if="avatarUrl" :src="avatarUrl" alt="" />
          <UserIcon v-else aria-hidden="true" />
        </button>
        <div class="information-who">
          <p class="information-name">
            <span class="information-name-text">{{ authorName || t("home.author") }}</span>
            <ActorMark :actor="actor" />
          </p>
          <p v-if="posted || category || language || formLabel" class="information-time">
            <span class="information-form">{{ t(formLabel) }}</span>
            <span v-if="posted || category || language"> · </span>
            <span v-if="posted">{{ posted }}</span>
            <span v-if="posted && (category || language)"> · </span>
            <button
              v-if="category"
              type="button"
              class="information-category"
              :class="{ 'is-on': categorySelected }"
              :aria-pressed="categorySelected"
              @click="onCategory"
            >
              {{ category }}
            </button>
            <span v-if="category && language"> · </span>
            <span v-if="language">{{ language }}</span>
          </p>
        </div>
      </div>
      <AppButton
        v-if="canFriend"
        class="information-friend"
        :class="{ 'is-friend': friend }"
        variant="secondary"
        type="button"
        :aria-label="friend ? t('home.removeFriend') : t('home.addFriend')"
        @click="emit('friend')"
      >
        <FriendAddIcon v-if="!friend" aria-hidden="true" />
        <template v-else>
          <FriendCheckIcon class="information-friend-on" aria-hidden="true" />
          <FriendRemoveIcon class="information-friend-off" aria-hidden="true" />
        </template>
      </AppButton>
      <span class="information-price" :aria-label="t('home.usePrice', { n: price })">
        <CoinIcon aria-hidden="true" />
        <span>{{ price }}</span>
      </span>
      <AppButton
        v-if="canClose"
        class="information-close"
        variant="icon"
        type="button"
        :disabled="closing"
        :aria-label="t('home.closeCard')"
        @click="emit('close')"
      >
        <RemovedIcon class="information-close-icon" aria-hidden="true" />
      </AppButton>
      <AppButton
        class="information-dismiss"
        variant="icon"
        type="button"
        :aria-label="t('home.dismiss')"
        @click="emit('dismiss')"
      >
        <CloseIcon class="information-dismiss-icon" aria-hidden="true" />
      </AppButton>
    </header>
    <div v-if="topics.length" class="information-topics">
      <button
        v-for="topic in topics"
        :key="topic"
        type="button"
        class="information-topic"
        :class="{ 'is-on': activeTopic === topic }"
        :aria-pressed="activeTopic === topic"
        @click="onTopic(topic)"
      >
        {{ topic }}
      </button>
    </div>
    <div v-if="body" class="information-body-wrap">
      <p v-if="!markdown" ref="bodyRef" class="information-body" :class="{ 'is-clamped': !bodyOpen }">{{ body }}</p>
      <p v-else-if="!bodyOpen" ref="bodyRef" class="information-body" :class="{ 'is-clamped': true }">{{ bodyPlain }}</p>
      <div v-else class="information-body information-md" v-html="bodyHtml"></div>
      <button
        v-if="bodyClipped || bodyOpen || markdown"
        type="button"
        class="information-more"
        :class="{ 'is-expanded': bodyOpen }"
        :aria-expanded="bodyOpen"
        @click="toggleBody"
      >
        {{ t(bodyOpen ? "home.less" : "home.more") }}
      </button>
    </div>
    <div v-if="photos.length" class="information-images" :class="`is-${photos.length}`">
      <img v-for="url in photos" :key="url" :src="url" alt="" class="information-photo" loading="lazy" decoding="async" />
    </div>
    <ul v-if="!photos.length && pendingImages.length" class="information-files">
      <li v-for="(file, index) in pendingImages" :key="file.id || `${file.name}-${index}`">
        <span class="information-file">
          <ImageIcon class="information-file-icon" aria-hidden="true" />
          <span>{{ file.name || t("home.image") }}</span>
        </span>
      </li>
    </ul>
    <div v-if="clips.length" class="information-audio">
      <template v-for="file in clips" :key="file.id || file.url || file.name">
        <audio v-if="file.url" :src="file.url" controls :aria-label="file.name || t('home.audio')" />
        <span v-else class="information-file">
          <AudioIcon class="information-file-icon" aria-hidden="true" />
          <span>{{ file.name || t("home.audio") }}</span>
        </span>
      </template>
    </div>
    <VideoFrame v-if="links[0]" :url="links[0].url" :poster="links[0].poster || ''" :play-url="links[0].playUrl || ''" />
    <ul v-if="files.length" class="information-files">
      <li v-for="(file, index) in files" :key="file.id || `${file.name}-${index}`">
        <span class="information-file">
          <PaperclipIcon class="information-file-icon" aria-hidden="true" />
          <span class="information-file-copy">
            <span class="information-file-name">{{ file.name || t("home.file") }}</span><span v-if="fileNote" class="information-file-note">{{ t("home.fileNoteJoin", { note: fileNote }) }}</span>
          </span>
        </span>
      </li>
    </ul>
    <div class="post-actions">
      <button
        v-if="canLike"
        type="button"
        class="post-action"
        :class="{ 'is-on': liked }"
        :aria-pressed="liked"
        :aria-label="liked ? t('home.unlike') : t('home.like')"
        @click="emit('like')"
      >
        <LikeIcon :filled="liked" aria-hidden="true" />
      </button>
      <button
        v-if="canStar"
        type="button"
        class="post-action"
        :class="{ 'is-on': starred }"
        :aria-pressed="starred"
        :aria-label="starred ? t('home.unstar') : t('home.star')"
        @click="emit('star')"
      >
        <StarIcon :filled="starred" aria-hidden="true" />
      </button>
      <button
        v-if="hasDownload"
        type="button"
        class="post-action"
        :disabled="busy"
        :aria-label="t('home.download')"
        @click="onDownload"
      >
        <DownloadIcon aria-hidden="true" />
      </button>
      <button
        type="button"
        class="post-action"
        :disabled="sharing"
        :aria-label="t('home.share')"
        @click="emit('share')"
      >
        <ShareIcon aria-hidden="true" />
      </button>
    </div>
    <p v-if="notice" class="error card-notice" role="alert">{{ notice }}</p>
  </article>
</template>
