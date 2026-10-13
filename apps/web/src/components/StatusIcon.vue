<script setup>
import { computed } from "vue";
import { AlertIcon, ClockIcon, PassedIcon, RejectedIcon, RemovedIcon, RespondIcon } from "../icons/index.js";

const props = defineProps({
  verdict: { type: String, default: "" },
  kind: { type: String, default: "" },
});

const marks = {
  pending: ClockIcon,
  passed: PassedIcon,
  rejected: RejectedIcon,
  removed: RemovedIcon,
  intel_passed: PassedIcon,
  intel_rejected: RejectedIcon,
  intel_removed: RemovedIcon,
  request_response: RespondIcon,
  warning: AlertIcon,
};

const icon = computed(() => marks[props.kind || props.verdict] || null);
</script>

<template>
  <component :is="icon" v-if="icon" class="status-icon" aria-hidden="true" />
</template>
