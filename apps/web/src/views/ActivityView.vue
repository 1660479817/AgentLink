<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { getDelegation } from "../api.js";
import { t } from "../i18n/index.js";
import { useSessionStore } from "../stores/session";

const session = useSessionStore();
const delegated = ref(false);
const createdAt = ref(null);
const failed = ref(false);
const loaded = ref(false);

const line = computed(() => {
  if (!delegated.value) return t("mine.agentCodeEmpty");
  if (!createdAt.value) return t("mine.agentCodeOnly", { code: t("mine.agentCodeMask") });
  return t("mine.agentCode", {
    code: t("mine.agentCodeMask"),
    time: formatTime(createdAt.value),
  });
});

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function load() {
  failed.value = false;
  loaded.value = false;
  delegated.value = false;
  createdAt.value = null;
  if (!session.user) {
    loaded.value = true;
    return;
  }
  try {
    const data = await getDelegation();
    delegated.value = Boolean(data.delegated || data.createdAt);
    createdAt.value = data.createdAt || null;
  } catch {
    failed.value = true;
  } finally {
    loaded.value = true;
  }
}

onMounted(load);
watch(() => session.user?.id, load);
</script>

<template>
  <h1 class="page-title">{{ t("activity.title") }}</h1>
  <p v-if="!session.user" class="muted">{{ t("mine.login") }}</p>
  <p v-else-if="failed" class="error" role="alert">{{ t("error.request_failed") }}</p>
  <section v-else-if="loaded" class="card">
    <p class="post-body">{{ line }}</p>
  </section>
</template>
