<script setup>
import { computed } from "vue";
import AppButton from "./AppButton.vue";
import { t } from "../i18n/index.js";
import { CloseIcon, DownloadIcon, PaperclipIcon, StarIcon, UserIcon } from "../icons/index.js";

const props = defineProps({
  body: { type: String, default: "" },
  category: { type: String, default: "" },
  price: { type: Number, default: 0 },
  granted: { type: Boolean, default: true },
  imageUrls: { type: Array, default: () => [] },
  images: { type: Array, default: () => [] },
  attachments: { type: Array, default: () => [] },
  authorName: { type: String, default: "" },
  avatarUrl: { type: String, default: "" },
  createdAt: { type: String, default: "" },
  starred: { type: Boolean, default: false },
  canStar: { type: Boolean, default: true },
  notice: { type: String, default: "" },
});

const emit = defineEmits(["dismiss", "star", "download"]);

const names = computed(() => {
  const pictures = props.imageUrls.length ? [] : props.images;
  const files = props.attachments.filter((item) => !item.url || !props.imageUrls.length || !item.image);
  return [...pictures, ...files.filter((item) => !item.url)];
});

const linked = computed(() => props.attachments.filter((item) => item.url && !item.image));

const canDownload = computed(
  () => props.granted === false && (props.images.length > 0 || props.attachments.length > 0)
);

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
</script>

<template>
  <article class="card post information-card">
    <header class="information-head">
      <div class="information-author">
        <span class="information-avatar" aria-hidden="true">
          <img v-if="avatarUrl" :src="avatarUrl" alt="" />
          <UserIcon v-else />
        </span>
        <div class="information-who">
          <p class="information-name">{{ authorName || t("home.author") }}</p>
          <p class="information-time">
            <span v-if="posted">{{ posted }}</span>
            <span v-if="posted && category"> · </span>
            <span v-if="category">{{ category }}</span>
            <span v-if="posted || category"> · </span>
            <span :aria-label="t('home.usePrice', { n: price })">{{ price }}</span>
          </p>
        </div>
      </div>
      <AppButton variant="icon" type="button" :aria-label="t('home.dismiss')" @click="emit('dismiss')">
        <CloseIcon aria-hidden="true" />
      </AppButton>
    </header>
    <p v-if="body" class="information-body">{{ body }}</p>
    <div v-if="imageUrls.length" class="information-images">
      <img v-for="url in imageUrls" :key="url" :src="url" alt="" class="information-photo" />
    </div>
    <ul v-if="names.length || linked.length" class="information-files">
      <li v-for="file in names" :key="`name-${file.id}`">
        <span class="information-file">
          <PaperclipIcon class="information-file-icon" aria-hidden="true" />
          <span>{{ file.name || t("home.file") }}</span>
        </span>
      </li>
      <li v-for="file in linked" :key="file.id">
        <a class="information-file" :href="file.url">
          <PaperclipIcon class="information-file-icon" aria-hidden="true" />
          <span>{{ file.name || t("home.file") }}</span>
        </a>
      </li>
    </ul>
    <div v-if="canStar || canDownload" class="post-actions">
      <button
        v-if="canDownload"
        type="button"
        class="post-action"
        :aria-label="t('home.download')"
        @click="emit('download')"
      >
        <DownloadIcon aria-hidden="true" />
        <span>{{ t("home.download") }}</span>
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
        <span>{{ starred ? t("home.starred") : t("home.star") }}</span>
      </button>
    </div>
    <p v-if="notice" class="error card-notice" role="alert">{{ notice }}</p>
  </article>
</template>
