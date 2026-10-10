<script setup>
import { computed } from "vue";
import { t } from "../i18n/index.js";

const props = defineProps({
  role: { type: String, required: true },
  body: { type: String, default: "" },
  imageUrls: { type: Array, default: () => [] },
  attachments: { type: Array, default: () => [] },
});

const files = computed(() => props.attachments.filter((item) => !item.image));

const roleLabel = computed(() => t(`role.${props.role}`));
</script>

<template>
  <article class="card post information-card">
    <header class="post-head information-head">
      <span class="role-badge" :data-role="role">{{ roleLabel }}</span>
    </header>
    <div v-if="imageUrls.length" class="information-images">
      <img v-for="url in imageUrls" :key="url" :src="url" alt="" class="information-photo" />
    </div>
    <div v-if="files.length" class="information-files">
      <a v-for="file in files" :key="file.id" class="chat-file-link" :href="file.url">{{ file.name || t("home.file") }}</a>
    </div>
    <p v-if="body" class="post-body information-body">{{ body }}</p>
  </article>
</template>
