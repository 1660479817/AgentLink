<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import ActorMark from "./ActorMark.vue";
import AppButton from "./AppButton.vue";
import PhotoGallery from "./PhotoGallery.vue";
import PhotoLightbox from "./PhotoLightbox.vue";
import VideoFrame from "./VideoFrame.vue";
import { t } from "../i18n/index.js";
import { AudioIcon, CloseIcon, CoinIcon, DownloadIcon, FriendAddIcon, FriendCheckIcon, FriendRemoveIcon, ImageIcon, PaperclipIcon, RemovedIcon, ShareIcon, StarIcon, TipIcon, UserIcon } from "../icons/index.js";
import { containsImage, isMarkdown, parse, toHtml, toPlain } from "@knot/markdown";
import { lockedImages, packetAudio, packetFile, packetForm, packetVideos, photoItems } from "../packet.js";
import { altLabel } from "../mediaLabel.js";
import { expiryOf, hoursLeftAt } from "../record.js";
import { useCardActionsStore } from "../stores/cardActions.js";
import { timeAgo } from "../time.js";

const props = defineProps({
  postId: { type: String, default: "" },
  body: { type: String, default: "" },
  category: { type: String, default: "" },
  topics: { type: Array, default: () => [] },
  categorySelected: { type: Boolean, default: false },
  activeTopic: { type: String, default: "" },
  language: { type: String, default: "" },
  price: { type: Number, default: 0 },
  // 这条一共收到多少打赏。0 表示还没有，卡片不在硬币旁边写数。
  tipTotal: { type: Number, default: 0 },
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
  friend: { type: Boolean, default: false },
  canFriend: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
  notice: { type: String, default: "" },
  canClose: { type: Boolean, default: false },
  closing: { type: Boolean, default: false },
});

const emit = defineEmits(["author", "category", "topic", "dismiss", "star", "download", "friend", "close"]);

// 底栏的打赏与分享都交给弹窗：卡片只把这条记录递出去，弹窗里再加功能不用回头改这里。
const cardActions = useCardActionsStore();

const photos = computed(() => photoItems(props.images));
const pendingImages = computed(() => lockedImages(props.images));
const clips = computed(() => packetAudio(props.audio));
const links = computed(() => packetVideos(props.videos));
const files = computed(() => packetFile(props.attachments));
const formLabel = computed(() => ({ text: "home.formText", image: "home.formImage", video: "home.formVideo" }[packetForm({ images: props.images, videos: props.videos })]));
const markdown = computed(() => isMarkdown(props.body));
const blocks = computed(() => (markdown.value ? parse(props.body) : []));
const bodyPlain = computed(() => (markdown.value ? toPlain(props.body) : props.body));
const bodyHtml = computed(() => toHtml(blocks.value));
// 图片没有单独的替代文本，拿正文摘要当 alt；正文为空时退回「图片」。
const mediaLabel = computed(() => altLabel(bodyPlain.value));
const posted = computed(() => timeAgo(props.createdAt));
// 现在发布不收费，价格总是 0；0 元的角标没有信息量，干脆不画。
const showPrice = computed(() => Number(props.price) > 0);
// 硬币旁边的累计：刚给完打赏时接口回的数比快照新，取大的那个。
const tipShown = computed(() => Math.max(Number(props.tipTotal) || 0, Number(cardActions.tipTotals[props.postId]) || 0));
const tipLabel = computed(() => (tipShown.value > 0 ? t("home.tipWithTotal", { n: tipShown.value }) : t("home.tip")));
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

function openTip() {
  if (!props.postId) return;
  cardActions.openTip({
    id: props.postId,
    authorId: props.authorId,
    authorName: props.authorName,
    avatarUrl: props.avatarUrl,
    body: props.body,
  });
}

function openShare() {
  if (!props.postId) return;
  cardActions.openShare({
    id: props.postId,
    authorName: props.authorName,
    body: props.body,
  });
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
      <span v-if="showPrice" class="information-price" :aria-label="t('home.usePrice', { n: price })">
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
    <PhotoGallery :photos="photos" :label="mediaLabel" />
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
    <VideoFrame v-if="links[0]" :url="links[0].url" :poster="links[0].poster || ''" :play-url="links[0].playUrl || ''" :label="mediaLabel" />
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
        v-if="postId && authorId && !mine"
        type="button"
        class="post-action"
        :class="{ 'is-counted': tipShown > 0 }"
        :aria-label="tipLabel"
        aria-haspopup="dialog"
        @click="openTip"
      >
        <TipIcon aria-hidden="true" />
        <span v-if="tipShown > 0" class="post-action-count">{{ tipShown }}</span>
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
        :aria-label="t('home.share')"
        aria-haspopup="dialog"
        @click="openShare"
      >
        <ShareIcon aria-hidden="true" />
      </button>
    </div>
    <p v-if="notice" class="error card-notice" role="alert">{{ notice }}</p>
    <PhotoLightbox :photos="viewer.photos" :label="mediaLabel" :open="viewer.open" :index="viewer.index" @close="viewer.open = false" />
  </article>
</template>
