<script setup>
import { computed } from "vue";
import AppButton from "./AppButton.vue";
import { t } from "../i18n/index.js";
import { CloseIcon, PaperclipIcon, UserIcon } from "../icons/index.js";

const props = defineProps({
  body: { type: String, default: "" },
  imageUrls: { type: Array, default: () => [] },
  attachments: { type: Array, default: () => [] },
  authorName: { type: String, default: "" },
  avatarUrl: { type: String, default: "" },
  createdAt: { type: String, default: "" },
});

const emit = defineEmits(["dismiss"]);

const files = computed(() => props.attachments.filter((item) => !item.image));

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
          <p v-if="posted" class="information-time">{{ posted }}</p>
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
    <ul v-if="files.length" class="information-files">
      <li v-for="file in files" :key="file.id">
        <a class="information-file" :href="file.url">
          <PaperclipIcon class="information-file-icon" aria-hidden="true" />
          <span>{{ file.name || t("home.file") }}</span>
        </a>
      </li>
    </ul>
  </article>
</template>
