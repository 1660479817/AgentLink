<script setup>
import { ref } from "vue";
import { RefreshIcon } from "../icons/index.js";
import { t } from "../i18n/index.js";
import { useInfoBufferStore } from "../stores/infoBuffer";

const props = defineProps({
  surfaces: { type: Array, required: true },
  plaza: { type: Object, default: () => ({}) },
});

const busy = ref(false);
const buffer = useInfoBufferStore();

async function onRefresh() {
  busy.value = true;
  try {
    await buffer.pull({ surfaces: props.surfaces, plaza: props.plaza }, { force: true });
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <button
    type="button"
    class="secondary icon-text-btn"
    :disabled="busy"
    :aria-label="t('common.refreshSnapshot')"
    @click="onRefresh"
  >
    <RefreshIcon class="nav-icon" aria-hidden="true" />
    <span>{{ busy ? t("common.refreshing") : t("common.refresh") }}</span>
  </button>
</template>
