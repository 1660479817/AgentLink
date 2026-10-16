<script setup>
import AppButton from "./AppButton.vue";
import { t } from "../i18n/index.js";
import { useOutboxStore } from "../stores/outbox";

const outbox = useOutboxStore();

function label(job) {
  if (job.name) return t("home.uploadingName", { name: job.name });
  return job.progress === 100 ? t("home.sending") : t("home.uploading");
}
</script>

<template>
  <section v-if="outbox.jobs.length" class="outbox" aria-live="polite">
    <article v-for="job in outbox.jobs" :key="job.id" class="card outbox-job">
      <p class="outbox-title">{{ label(job) }}</p>
      <progress
        v-if="job.status === 'sending' && job.progress < 100"
        class="outbox-progress"
        :value="job.progress"
        max="100"
        :aria-label="label(job)"
      />
      <p v-if="job.status === 'failed'" class="error" role="alert">{{ job.error }}</p>
      <AppButton v-if="job.status === 'failed'" variant="secondary" @click="outbox.dismiss(job.id)">
        {{ t("home.dismissOutbox") }}
      </AppButton>
    </article>
  </section>
</template>
