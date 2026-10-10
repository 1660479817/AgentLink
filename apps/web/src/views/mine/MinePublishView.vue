<script setup>
import { computed, ref } from "vue";
import EmptyState from "../../components/EmptyState.vue";
import { uploadImage } from "../../api.js";
import { formatDateTime } from "../../lib/format.js";
import { t } from "../../i18n/index.js";
import { useInfoBufferStore } from "../../stores/infoBuffer";

const buffer = useInfoBufferStore();
const jobs = computed(() => buffer.surfaces.mine?.ingestJobs ?? []);
const error = ref("");
const uploading = ref(false);

async function onFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  uploading.value = true;
  error.value = "";
  try {
    await uploadImage(file);
    await buffer.invalidate();
  } catch (err) {
    error.value = err.code || err.message;
  } finally {
    uploading.value = false;
    e.target.value = "";
  }
}
</script>

<template>
  <div class="card">
    <h2 style="margin-top: 0">{{ t("mine.provideTitle") }}</h2>
    <p class="muted">{{ t("mine.provideIntro") }}</p>
    <label for="upload-image">{{ t("mine.uploadLabel") }}</label>
    <input id="upload-image" type="file" accept="image/*" :disabled="uploading" @change="onFile" />
    <p v-if="uploading" class="muted">{{ t("mine.uploading") }}</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <h3 style="font-size: 1rem">{{ t("mine.jobsTitle") }}</h3>
    <EmptyState v-if="jobs.length === 0" :title="t('mine.jobsEmpty')" :hint="t('mine.jobsEmptyHint')" />
    <ul v-else class="job-list">
      <li v-for="j in jobs" :key="j.id">
        <strong>{{ j.status }}</strong> · {{ j.mime }} · {{ formatDateTime(j.createdAt) }}
        <span v-if="j.error" class="error"> · {{ j.error }}</span>
      </li>
    </ul>
  </div>
</template>
