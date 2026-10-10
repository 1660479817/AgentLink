<script setup>
import { computed } from "vue";
import { t } from "../i18n/index.js";

const props = defineProps({
  role: { type: String, required: true },
  body: { type: String, default: "" },
  imageUrls: { type: Array, default: () => [] },
  category: { type: String, default: "" },
  compact: { type: Boolean, default: false },
});

const roleLabel = computed(() => t(`role.${props.role}`));
</script>

<template>
  <article class="card post information-card" :class="{ 'information-card-compact': compact }">
    <header class="post-head information-head">
      <span class="role-badge" :data-role="role">{{ roleLabel }}</span>
      <span v-if="category" class="info-category">{{ category }}</span>
    </header>
    <div v-if="imageUrls.length" class="information-images">
      <img v-for="url in imageUrls" :key="url" :src="url" alt="" class="information-photo" />
    </div>
    <p v-if="body" class="post-body information-body">{{ body }}</p>
  </article>
</template>
