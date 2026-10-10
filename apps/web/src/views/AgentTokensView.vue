<script setup>
import { onMounted, ref } from "vue";
import { issueAgentToken, listAgentTokens, revokeAgentToken } from "../api.js";
import { formatDateTime } from "../lib/format.js";
import { t } from "../i18n/index.js";
import { useInfoBufferStore } from "../stores/infoBuffer";

const buffer = useInfoBufferStore();
const tokens = ref([]);
const issued = ref(null);
const label = ref("openclaw");
const error = ref("");

async function load() {
  const data = await listAgentTokens();
  tokens.value = data.tokens || [];
}

onMounted(() => {
  load().catch((e) => {
    error.value = e.code || e.message;
  });
});

async function revoke(tokenId) {
  error.value = "";
  try {
    await revokeAgentToken(tokenId);
    await load();
    await buffer.invalidate();
  } catch (err) {
    error.value = err.code || err.message;
  }
}

async function issue() {
  error.value = "";
  issued.value = null;
  try {
    const data = await issueAgentToken(label.value);
    issued.value = data.token;
    await load();
    await buffer.invalidate();
  } catch (err) {
    error.value = err.code || err.message;
  }
}
</script>

<template>
  <p class="muted">
    <RouterLink :to="{ name: 'mine-settings' }">{{ t("agent.backMine") }}</RouterLink>
  </p>
  <div class="card">
    <h2 style="margin-top: 0">{{ t("agent.title") }}</h2>
    <p class="muted">
      {{ t("agent.intro") }}
      <code translate="no">KNOT_AGENT_EMAIL</code> +
      <code translate="no">KNOT_AGENT_TOKEN</code>
    </p>
    <form style="display: flex; gap: 8px; flex-wrap: wrap" @submit.prevent="issue">
      <label for="token-label" class="muted">{{ t("agent.labelField") }}</label>
      <input
        id="token-label"
        v-model="label"
        name="label"
        type="text"
        spellcheck="false"
        autocomplete="off"
        :placeholder="t('agent.labelPlaceholder')"
      />
      <button type="submit">{{ t("agent.issue") }}</button>
    </form>
    <p v-if="issued">
      <strong>{{ t("agent.issuedOnce") }}</strong>
      <code translate="no">{{ issued }}</code>
    </p>
  </div>
  <p v-if="error" class="error" role="alert">{{ error }}</p>
  <ul>
    <li v-for="tok in tokens" :key="tok.token_id" class="muted" style="margin-bottom: 8px">
      …{{ tok.token_last4 }} · {{ tok.label || "—" }} · {{ tok.status }} ·
      {{ formatDateTime(tok.created_at) }}
      <button
        v-if="tok.status === 'active'"
        type="button"
        class="secondary"
        @click="revoke(tok.token_id)"
      >
        {{ t("agent.revoke") }}
      </button>
    </li>
  </ul>
</template>
