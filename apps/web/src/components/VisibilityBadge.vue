<script setup>
import { computed } from "vue";
import { t } from "../i18n/index.js";

const props = defineProps({
  visibility: { type: String, default: "public" },
});

const label = computed(() => {
  const key = {
    public: "common.visibilityPublic",
    registered: "common.visibilityRegistered",
    verified: "common.visibilityVerified",
  }[props.visibility];
  return t(key || "common.visibilityPublic");
});
</script>

<template>
  <span class="vis-badge">{{ label }}</span>
</template>
