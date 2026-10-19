<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import ActorMark from "./ActorMark.vue";
import AppButton from "./AppButton.vue";
import PhotoGallery from "./PhotoGallery.vue";
import PhotoLightbox from "./PhotoLightbox.vue";
import VideoFrame from "./VideoFrame.vue";
import { t } from "../i18n/index.js";
import { AudioIcon, CloseIcon, CoinIcon, DownloadIcon, FriendAddIcon, FriendCheckIcon, FriendRemoveIcon, ImageIcon, LikeIcon, PaperclipIcon, RemovedIcon, ShareIcon, StarIcon, UserIcon } from "../icons/index.js";
import { containsImage, isMarkdown, parse, toHtml, toPlain } from "@knot/markdown";
import { lockedImages, packetAudio, packetFile, packetForm, packetVideos, photoUrls } from "../packet.js";
import { expiryOf, hoursLeftAt } from "../record.js";
import { timeAgo } from "../time.js";

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
  kind: { type: String, default: "" },
  expiresAt: { type: String, default: "" },
  mine: { type: Boolean, default: false },
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

const photos = computed(() => photoUrls(props.images));
const pendingImages = computed(() => lockedImages(props.images));
const clips = computed(() => packetAudio(props.audio));
const links = computed(() => packetVideos(props.videos));
const files = computed(() => packetFile(props.attachments));
const formLabel = computed(() => ({ text: "home.formText", image: "home.formImage", video: "home.formVideo" }[packetForm({ images: props.images, videos: props.videos })]));
const markdown = computed(() => isMarkdown(props.body));
const blocks = computed(() => (markdown.value ? parse(props.body) : []));
const bodyPlain = computed(() => (markdown.value ? toPlain(props.body) : props.body));
const bodyHtml = computed(() => toHtml(blocks.value));
const posted = computed(() => timeAgo(props.createdAt));
// 时效只给作者自己看：一条已经取到的记录，算一次剩余小时，不发额外请求。
// null 表示这条不会因时间失效（免费帖），0 表示已经到期。
const expiryLeft = computed(() => (props.mine ? hoursLeftAt(expiryOf({ kMeta: { kind: props.kind, expiresAt: props.expiresAt } })) : null));
const fileNote = computed(() => String(props.note || "").trim() || (props.verdict === "pending" ? t("home.filePrechecked") : ""));

const bodyRef = ref(null);
const bodyOpen = ref(false);
const bodyClipped = ref(false);
const viewer = ref({ open: false, index: 0, photos: [] });
const hasBodyImage = computed(() => containsImage(blocks.value));

function measureBody() {
  const el = bodyRef.value;
  if (!el || bodyOpen.value) return;
  bodyClipped.value = el.scrollHeight > el.clientHeight + 1;
}

function toggleBody() {
  bodyOpen.value = !bodyOpen.value;
  nextTick(measureBody);
}

function openBodyImage(event) {
  const img = event.target.closest?.("img");
  const box = event.currentTarget;
  if (!img || !box?.contains(img)) return;
  const images = [...box.querySelectorAll("img")];
  const index = images.indexOf(img);
  if (index < 0) return;
  viewer.value = { open: true, index, photos: images.map((item) => item.getAttribute("src") || "") };
}

function onDownload() {
  if (props.busy) return;
  emit("download");
}

onMounted(() => {
  bodyOpen.value = hasBodyImage.value;
  nextTick(measureBody);
  window.addEventListener("resize", measureBody);
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", measureBody);
});

watch(
  () => props.body,
  () => {
    bodyOpen.value = hasBodyImage.value;
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
          @click="authorId && emit('author')"
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
              @click="emit('category')"
            >
              {{ category }}
            </button>
            <span v-if="category && language"> · </span>
            <span v-if="language">{{ language }}</span>
            <template v-if="expiryLeft !== null">
              <span v-if="posted || category || language"> · </span>
              <span class="information-expiry" :class="{ 'is-expired': expiryLeft === 0 }">
                {{ expiryLeft === 0 ? t("home.expiryExpired") : t("home.expiryLeft", { n: expiryLeft }) }}
              </span>
            </template>
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
        @click="emit('topic', topic)"
      >
        {{ topic }}
      </button>
    </div>
    <div v-if="body" class="information-body-wrap">
      <p v-if="!markdown" ref="bodyRef" class="information-body" :class="{ 'is-clamped': !bodyOpen }">{{ body }}</p>
      <p v-else-if="!bodyOpen" ref="bodyRef" class="information-body" :class="{ 'is-clamped': true }">{{ bodyPlain }}</p>
      <div v-else class="information-body information-md" v-html="bodyHtml" @click="openBodyImage"></div>
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
    <PhotoGallery :photos="photos" />
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
        v-if="files.length"
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
    <PhotoLightbox :photos="viewer.photos" :open="viewer.open" :index="viewer.index" @close="viewer.open = false" />
  </article>
</template>
