<script setup>
import { onMounted, ref, watch } from "vue";
import AppButton from "../components/AppButton.vue";
import { getPoints } from "../api.js";
import { t } from "../i18n/index.js";
import { AgentIcon, LogInIcon, PlusIcon } from "../icons/index.js";
import { useSessionStore } from "../stores/session";

const session = useSessionStore();
const balance = ref(null);
const authBusy = ref(false);
const authError = ref("");

function shortId(id) {
  const text = String(id || "");
  return text.length > 8 ? `${text.slice(0, 8)}…` : text;
}

async function loadPoints() {
  if (!session.person) {
    balance.value = null;
    return;
  }
  try {
    const data = await getPoints();
    balance.value = data.balance;
  } catch {
    balance.value = null;
  }
}

async function login() {
  authError.value = "";
  authBusy.value = true;
  try {
    await session.start();
    await loadPoints();
  } catch {
    authError.value = t("error.request_failed");
  } finally {
    authBusy.value = false;
  }
}

async function register() {
  authError.value = "";
  authBusy.value = true;
  try {
    if (session.person) await session.end();
    await session.start();
    await loadPoints();
  } catch {
    authError.value = t("error.request_failed");
  } finally {
    authBusy.value = false;
  }
}

onMounted(loadPoints);
watch(() => session.person?.id, loadPoints);
</script>

<template>
  <h1 class="page-title">{{ t("mine.title") }}</h1>

  <section v-if="!session.person" class="card">
    <p class="muted">{{ t("mine.guestHint") }}</p>
    <p v-if="authError" class="error" role="alert">{{ authError }}</p>
    <div class="form-actions mine-auth-actions">
      <AppButton :disabled="authBusy" @click="login">
        <LogInIcon aria-hidden="true" />
        {{ t("mine.loginAction") }}
      </AppButton>
      <AppButton variant="secondary" :disabled="authBusy" @click="register">
        <PlusIcon aria-hidden="true" />
        {{ t("mine.register") }}
      </AppButton>
    </div>
  </section>

  <template v-else>
    <section class="card">
      <h2 class="post-name">{{ t("mine.account") }}</h2>
      <p class="post-body">{{ t("mine.accountId", { id: shortId(session.person.id) }) }}</p>
      <p class="muted">{{ t("mine.accountHint") }}</p>
    </section>
    <section class="card">
      <h2 class="post-name">{{ t("mine.points") }}</h2>
      <p class="muted">{{ t("mine.pointsHint") }}</p>
      <p class="post-name">
        {{
          balance === null
            ? t("mine.pointsBalance", { balance: "—" })
            : t("mine.pointsBalance", { balance })
        }}
      </p>
    </section>
    <section class="card">
      <h2 class="post-name">{{ t("mine.agent") }}</h2>
      <p class="muted">{{ t("mine.agentHint") }}</p>
      <div class="form-actions">
        <AppButton to="/delegate">
          <AgentIcon aria-hidden="true" />
          {{ t("mine.agentOpen") }}
        </AppButton>
      </div>
    </section>
  </template>
</template>
