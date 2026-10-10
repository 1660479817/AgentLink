<script setup>
defineProps({
  title: { type: String, required: true },
  hint: { type: String, default: "" },
  icon: { type: Object, default: null },
});
</script>

<template>
  <div class="empty-state">
    <component :is="icon" v-if="icon" class="empty-state-icon" aria-hidden="true" />
    <p class="empty-state-title">{{ title }}</p>
    <p v-if="hint" class="muted empty-state-hint">{{ hint }}</p>
  </div>
</template>
