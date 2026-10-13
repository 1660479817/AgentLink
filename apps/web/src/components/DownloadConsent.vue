<script setup>
import { nextTick, ref, watch } from "vue";
import AppButton from "./AppButton.vue";
import { downloadConsent, settleDownload } from "../download/consent.js";
import { t } from "../i18n/index.js";

const dialog = ref(null);

watch(downloadConsent, async (job) => {
  await nextTick();
  const el = dialog.value;
  if (!el) return;
  if (job && !el.open) el.showModal();
  if (!job && el.open) el.close();
});

function onCancel(event) {
  event.preventDefault();
  settleDownload(false);
}

function onBackdrop(event) {
  if (event.target === event.currentTarget) settleDownload(false);
}
</script>

<template>
  <dialog
    ref="dialog"
    class="download-consent"
    aria-labelledby="download-consent-title"
    aria-describedby="download-consent-body"
    @cancel="onCancel"
    @click="onBackdrop"
  >
    <template v-if="downloadConsent">
    <p id="download-consent-title" class="download-consent-title">{{ t("download.title") }}</p>
    <p id="download-consent-body" class="download-consent-body">
      {{
        t("download.consent", {
          n: downloadConsent?.amount || 0,
          payee: t(downloadConsent?.payee === "platform" ? "download.platform" : "download.author"),
        })
      }}
    </p>
    <div class="download-consent-actions">
      <AppButton variant="secondary" type="button" @click="settleDownload(false)">{{ t("download.cancel") }}</AppButton>
      <AppButton type="button" @click="settleDownload(true)">{{ t("download.confirm") }}</AppButton>
    </div>
    </template>
  </dialog>
</template>
