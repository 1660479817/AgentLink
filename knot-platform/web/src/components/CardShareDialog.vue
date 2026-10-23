<script setup>
import { computed, ref } from "vue";
import AppButton from "./AppButton.vue";
import { CheckIcon, CloseIcon, CopyIcon, LongImageIcon, ShareIcon } from "../icons/index.js";
import { toPlain } from "@knot/markdown";
import { t } from "../i18n/index.js";
import { downloadShare } from "../api.js";
import { cardShareUrl, copyCardLink } from "../share.js";
import { useCardDialog } from "../composers/cardDialog.js";
import { useCardActionsStore } from "../stores/cardActions.js";

// 分享弹窗：卡片只负责把这条记录交出来，之后加多少种分享去向都长在这里。
// 操作排成一行小按钮，不铺满弹窗，也不做成一格一格的入口面板。
const store = useCardActionsStore();
const copied = ref(false);
const imageState = ref("");
const error = ref("");
// 剪贴板被浏览器拒掉时，把链接露出来让人手动选中，否则用户拿不到东西。
const showLink = ref(false);
let copyTimer = 0;

const post = computed(() => store.share);
const origin = typeof window !== "undefined" ? window.location.origin : "";
const url = computed(() => (post.value?.id ? cardShareUrl(post.value.id, origin) : ""));
const preview = computed(() => {
  const text = toPlain(String(post.value?.body || "")).replace(/\s+/g, " ").trim();
  return text.length > 90 ? `${text.slice(0, 90)}…` : text;
});
// 系统分享只在支持 Web Share 的浏览器上出现，其它地方留复制链接。
const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

const { dialog, closeDialog, onBackdrop } = useCardDialog(() => store.share, { onOpen: reset });

function reset() {
  clearTimeout(copyTimer);
  copyTimer = 0;
  copied.value = false;
  imageState.value = "";
  error.value = "";
  showLink.value = false;
}

function close() {
  closeDialog();
  store.closeShare();
}

async function copyLink() {
  if (!post.value?.id) return;
  error.value = "";
  const result = await copyCardLink(post.value.id, origin);
  if (!result.copied) {
    // 复制失败时把地址露出来让人手动选中，别让按钮按下去什么都不发生。
    showLink.value = true;
    error.value = t("home.shareLinkManual");
    return;
  }
  copied.value = true;
  showLink.value = false;
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => {
    copied.value = false;
  }, 2000);
}

async function saveImage() {
  if (!post.value?.id || imageState.value === "saving") return;
  error.value = "";
  imageState.value = "saving";
  try {
    await downloadShare(post.value.id);
    imageState.value = "done";
  } catch {
    imageState.value = "";
    error.value = t("home.shareImageFailed");
  }
}

async function shareSystem() {
  if (!url.value) return;
  error.value = "";
  try {
    await navigator.share({ title: document.title || t("home.shareTitle"), text: preview.value, url: url.value });
  } catch (err) {
    // 用户自己取消不算失败。
    if (err?.name !== "AbortError") error.value = t("home.shareSystemFailed");
  }
}
</script>

<template>
  <dialog ref="dialog" class="card-share" aria-labelledby="card-share-title" @cancel.prevent="close" @click="onBackdrop">
    <header class="card-share-head">
      <h2 id="card-share-title" class="card-share-title">{{ t("home.shareTitle") }}</h2>
      <AppButton variant="icon" plain :aria-label="t('home.shareClose')" @click="close">
        <CloseIcon class="card-share-close" aria-hidden="true" />
      </AppButton>
    </header>
    <p v-if="preview" class="card-share-preview">{{ preview }}</p>
    <div class="card-share-actions">
      <button type="button" class="card-share-action" @click="copyLink">
        <span class="card-share-action-icon" :class="{ 'is-on': copied }" aria-hidden="true">
          <CheckIcon v-if="copied" />
          <CopyIcon v-else />
        </span>
        <span class="card-share-action-label">{{ copied ? t("home.shareLinkCopied") : t("home.shareCopyLink") }}</span>
      </button>
      <button type="button" class="card-share-action" :disabled="imageState === 'saving'" @click="saveImage">
        <span class="card-share-action-icon" :class="{ 'is-on': imageState === 'done' }" aria-hidden="true">
          <CheckIcon v-if="imageState === 'done'" />
          <LongImageIcon v-else />
        </span>
        <span class="card-share-action-label">{{ imageState === "done" ? t("home.shareImageDone") : t("home.shareSaveImage") }}</span>
      </button>
      <button v-if="canNativeShare" type="button" class="card-share-action" @click="shareSystem">
        <span class="card-share-action-icon" aria-hidden="true"><ShareIcon /></span>
        <span class="card-share-action-label">{{ t("home.shareSystem") }}</span>
      </button>
    </div>
    <p v-if="showLink" class="card-share-link">{{ url }}</p>
    <p v-if="error" class="error card-share-error" role="alert">{{ error }}</p>
  </dialog>
</template>
