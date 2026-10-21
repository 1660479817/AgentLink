<script setup>
import { computed, ref } from "vue";
import AppButton from "./AppButton.vue";
import SiteMark from "./SiteMark.vue";
import { t } from "../i18n/index.js";
import { useSessionStore } from "../stores/session";

// 顶栏站点名点开后显示：这是哪个站点、谁在负责（主理人 / owner）。
// 资料来自站点档案 sites/<站点>/profile.json，主理人在 /admin 里填写；没填时只显示站点信息和一个空态。
const session = useSessionStore();
const dialog = ref(null);

const owner = computed(() => session.owner);
const ownerName = computed(() => String(owner.value?.name || "").trim());
const note = computed(() => String(owner.value?.note || "").trim());
const contact = computed(() => String(owner.value?.contact || "").trim());
const hasOwner = computed(() => Boolean(ownerName.value || note.value || contact.value));
const contactHref = computed(() => {
  const value = contact.value;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return `mailto:${value}`;
  if (/^https?:\/\//i.test(value)) return value;
  return "";
});

const siteOrigin = typeof window !== "undefined" ? window.location.origin : "";
const siteHost = typeof window !== "undefined" ? window.location.host : "";

function open() {
  const el = dialog.value;
  if (el && !el.open) el.showModal();
}

function close() {
  dialog.value?.close();
}

function onBackdrop(event) {
  if (event.target === event.currentTarget) close();
}

defineExpose({ open });
</script>

<template>
  <dialog
    ref="dialog"
    class="site-owner"
    aria-labelledby="site-owner-title"
    @cancel.prevent="close"
    @click="onBackdrop"
  >
    <div class="site-owner-head">
      <SiteMark class="site-owner-mark" :text="session.brandName" />
      <div class="site-owner-heading">
        <h2 id="site-owner-title" class="site-owner-title">{{ session.brandName }}</h2>
        <p v-if="session.brandTagline" class="site-owner-tagline">{{ session.brandTagline }}</p>
      </div>
    </div>

    <div class="site-owner-body">
      <p class="site-owner-kicker">{{ t("owner.title") }}</p>
      <template v-if="hasOwner">
        <p v-if="ownerName" class="site-owner-name">{{ ownerName }}</p>
        <p v-if="note" class="site-owner-note">{{ note }}</p>
        <p v-if="contact" class="site-owner-contact">
          <a v-if="contactHref" :href="contactHref" target="_blank" rel="noopener noreferrer">{{ contact }}</a>
          <span v-else>{{ contact }}</span>
        </p>
      </template>
      <p v-else class="site-owner-empty">{{ t("owner.empty") }}</p>
    </div>

    <p class="site-owner-site">
      <span class="site-owner-site-label">{{ t("owner.site") }}</span>
      <a :href="siteOrigin" target="_blank" rel="noopener noreferrer" :title="t('owner.siteLink')">{{ siteHost }}</a>
    </p>

    <div class="site-owner-actions">
      <AppButton variant="secondary" type="button" @click="close">{{ t("owner.close") }}</AppButton>
    </div>
  </dialog>
</template>
