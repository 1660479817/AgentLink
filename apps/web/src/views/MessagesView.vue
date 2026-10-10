<script setup>
import { onMounted, ref } from "vue";
import AppButton from "../components/AppButton.vue";
import { connectMatch } from "../api.js";
import { t } from "../i18n/index.js";
import { useMessageStore } from "../stores/messages";

const messages = useMessageStore();
const connectResult = ref(null);
const connectError = ref("");
const busy = ref(false);

onMounted(() => messages.open());

async function connect(matchId) {
  connectError.value = "";
  connectResult.value = null;
  busy.value = true;
  try {
    connectResult.value = await connectMatch(matchId);
    await messages.load();
  } catch (err) {
    const key = `error.${err.code}`;
    connectError.value = t(key) === key ? t("error.request_failed") : t(key);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <h1 class="page-title">{{ t("messages.title") }}</h1>
  <p class="muted">{{ t("messages.hint") }}</p>
  <p v-if="messages.loaded && messages.guest" class="muted">{{ t("messages.login") }}</p>
  <p v-else-if="messages.loaded && messages.items.length === 0" class="muted">{{ t("messages.empty") }}</p>
  <p v-if="connectError" class="error" role="alert">{{ connectError }}</p>
  <section v-if="connectResult" class="card">
    <h2 class="post-name">{{ t("messages.connectDone") }}</h2>
    <p class="muted">{{ t("messages.rawSelf") }}</p>
    <p class="post-body">{{ connectResult.rawSelf }}</p>
    <p class="muted">{{ t("messages.rawPeer") }}</p>
    <p class="post-body">{{ connectResult.rawPeer }}</p>
    <p class="muted">{{ t("messages.contact") }}</p>
    <p class="post-body">{{ connectResult.contact }}</p>
  </section>
  <article v-for="item in messages.items" :key="item.id" class="card post">
    <header class="post-head">
      <div>
        <h2 class="post-name">{{ t(`role.${item.role}`) }}</h2>
        <p class="muted post-meta">{{ t(item.direction === "in" ? "messages.response" : "messages.sent") }}</p>
      </div>
    </header>
    <p class="post-body">{{ item.body }}</p>
    <div v-if="item.canConnect" class="form-actions">
      <AppButton :disabled="busy" @click="connect(item.matchId)">{{ t("messages.connect") }}</AppButton>
    </div>
    <p v-else-if="item.connected" class="muted">{{ t("messages.connected") }}</p>
  </article>
</template>
