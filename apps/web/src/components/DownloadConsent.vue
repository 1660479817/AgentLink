<script setup>
import { computed, nextTick, ref, watch } from "vue";
import AppButton from "./AppButton.vue";
import { errorText } from "../composers/packet.js";
import { dismissDownload, downloadConsent, settleDownload } from "../download/consent.js";
import { AlertIcon, ClockIcon, CoinIcon, PassedIcon } from "../icons/index.js";
import { t } from "../i18n/index.js";

const dialog = ref(null);
const phase = computed(() => downloadConsent.value?.phase || "");
const phaseIcon = computed(() => {
  if (phase.value === "confirm") return CoinIcon;
  if (phase.value === "working") return ClockIcon;
  if (phase.value === "done") return PassedIcon;
  if (phase.value === "error") return AlertIcon;
  return null;
});

const short = computed(() => Boolean(downloadConsent.value?.short));

const body = computed(() => {
  const job = downloadConsent.value;
  if (!job) return "";
  if (job.phase === "confirm") {
    if (job.kind === "own") return t("download.own");
    if (job.kind === "again") return t("download.again");
    if (job.kind === "free") return t("download.free");
    const parts = [];
    if (job.price > 0) parts.push(t("download.partPrice", { price: job.price }));
    if (job.fee > 0) parts.push(t("download.partFee", { fee: job.fee }));
    const detail = parts.length ? `（${parts.join(" + ")}）` : "";
    return t(job.short ? "download.short" : "download.consent", {
      n: job.amount || 0,
      detail,
      balance: job.balance || 0,
    });
  }
  if (job.phase === "working") return t("download.working");
  if (job.phase === "done") return t("download.done");
  return errorText(job.code);
});

watch(downloadConsent, async (job) => {
  await nextTick();
  const el = dialog.value;
  if (!el) return;
  if (job && !el.open) el.showModal();
  if (!job && el.open) el.close();
});

function onCancel(event) {
  event.preventDefault();
  if (phase.value === "confirm") settleDownload(false);
  else if (phase.value === "done" || phase.value === "error") dismissDownload();
}

function onBackdrop(event) {
  if (event.target !== event.currentTarget) return;
  if (phase.value === "confirm") settleDownload(false);
  else if (phase.value === "done" || phase.value === "error") dismissDownload();
}
</script>

<template>
  <dialog
    ref="dialog"
    class="download-consent"
    aria-labelledby="download-consent-title"
    aria-describedby="download-consent-body"
    :aria-busy="phase === 'working'"
    @cancel="onCancel"
    @click="onBackdrop"
  >
    <template v-if="downloadConsent">
      <p id="download-consent-title" class="download-consent-title">
        <component
          :is="phaseIcon"
          v-if="phaseIcon"
          class="status-icon"
          :class="{ 'is-coin': phase === 'confirm', 'is-alert': phase === 'error' }"
          aria-hidden="true"
        />
        <span>{{ t("download.title") }}</span>
      </p>
      <p
        id="download-consent-body"
        class="download-consent-body"
        :class="{ 'is-error': phase === 'error' }"
        :role="phase === 'error' ? 'alert' : 'status'"
      >
        {{ body }}
      </p>
      <div v-if="phase === 'confirm'" class="download-consent-actions">
        <AppButton variant="secondary" type="button" @click="settleDownload(false)">{{ t("download.cancel") }}</AppButton>
        <AppButton type="button" :disabled="short" @click="settleDownload(true)">{{ t("download.confirm") }}</AppButton>
      </div>
      <div v-else-if="phase === 'done' || phase === 'error'" class="download-consent-actions">
        <AppButton variant="secondary" type="button" @click="dismissDownload">{{ t("download.close") }}</AppButton>
      </div>
    </template>
  </dialog>
</template>
