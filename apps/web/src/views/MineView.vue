<script setup>
import { computed, onMounted, ref, watch } from "vue";
import AppButton from "../components/AppButton.vue";
import { RefreshIcon, UserIcon } from "../icons";
import { t } from "../i18n";
import { createDelegation, getDelegation, updateProfile, uploadImage } from "../api";
import { useSessionStore } from "../stores/session";

const session = useSessionStore();
const error = ref("");
const busy = ref(false);
const agentCreatedAt = ref(null);
const agentDelegated = ref(false);
const agentBrief = ref("");
const agentBusy = ref(false);
const agentError = ref("");
let agentLoad = 0;
const name = ref("");
const email = ref("");
const loginKey = ref("");
const keySent = ref(false);
const fileInput = ref(null);

onMounted(() => {
  if (session.user) session.load();
});

watch(
  () => session.user?.id,
  (id) => {
    agentBrief.value = "";
    agentError.value = "";
    agentCreatedAt.value = null;
    agentDelegated.value = false;
    if (!id) return;
    loadAgent();
  },
  { immediate: true }
);

watch(
  () => session.user?.displayName,
  (displayName) => {
    name.value = displayName || "";
  },
  { immediate: true }
);

const entitlementText = computed(() => {
  const value = session.user?.entitlements;
  if (!value || typeof value !== "object" || Object.keys(value).length === 0) {
    return t("mine.entitlementsEmpty");
  }
  return Object.keys(value).join("、");
});

const agentLine = computed(() => {
  if (!agentDelegated.value) return t("mine.agentCodeEmpty");
  if (!agentCreatedAt.value) return t("mine.agentCodeOnly", { code: t("mine.agentCodeMask") });
  return t("mine.agentCode", {
    code: t("mine.agentCodeMask"),
    time: formatAgentTime(agentCreatedAt.value),
  });
});

function formatAgentTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function showError(err) {
  const key = `error.${err.code}`;
  const message = t(key);
  error.value = message === key ? t("error.request_failed") : message;
}

async function sendKey() {
  error.value = "";
  busy.value = true;
  try {
    await session.requestKey(email.value);
    keySent.value = true;
    loginKey.value = "";
  } catch (err) {
    showError(err);
  } finally {
    busy.value = false;
  }
}

async function confirmKey() {
  error.value = "";
  busy.value = true;
  try {
    await session.confirmKey(email.value, loginKey.value);
  } catch (err) {
    showError(err);
  } finally {
    busy.value = false;
  }
}

function changeEmail() {
  error.value = "";
  keySent.value = false;
  loginKey.value = "";
}

async function saveName() {
  error.value = "";
  busy.value = true;
  try {
    const data = await updateProfile({ displayName: name.value });
    session.user = data.user;
  } catch (err) {
    showError(err);
  } finally {
    busy.value = false;
  }
}

async function pickAvatar(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  if (!String(file.type || "").startsWith("image/")) {
    error.value = t("error.bad_mime");
    return;
  }
  error.value = "";
  busy.value = true;
  try {
    const uploaded = await uploadImage(file);
    const data = await updateProfile({ avatarUploadId: uploaded.id });
    session.user = data.user;
  } catch (err) {
    showError(err);
  } finally {
    busy.value = false;
  }
}

function showAgentError(err) {
  const key = `error.${err.code}`;
  const message = t(key);
  agentError.value = message === key ? t("error.request_failed") : message;
}

async function loadAgent() {
  if (!session.user) return;
  const ticket = ++agentLoad;
  try {
    const data = await getDelegation();
    if (ticket !== agentLoad) return;
    agentDelegated.value = Boolean(data.delegated || data.createdAt);
    agentCreatedAt.value = data.createdAt || null;
  } catch (err) {
    if (ticket !== agentLoad) return;
    showAgentError(err);
  }
}

async function regenerate() {
  agentError.value = "";
  agentBusy.value = true;
  const ticket = ++agentLoad;
  try {
    const data = await createDelegation();
    if (ticket !== agentLoad) return;
    agentDelegated.value = true;
    agentCreatedAt.value = data.createdAt || new Date().toISOString();
    agentBrief.value = t("mine.agentBrief", {
      origin: window.location.origin,
      email: session.user?.email || "",
      token: data.token,
    });
  } catch (err) {
    if (ticket !== agentLoad) return;
    showAgentError(err);
  } finally {
    if (ticket === agentLoad) agentBusy.value = false;
  }
}

async function leave() {
  error.value = "";
  busy.value = true;
  try {
    await session.end();
  } catch (err) {
    showError(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <h1 class="page-title">{{ t("mine.title") }}</h1>

  <section v-if="!session.user" class="card">
    <h2 class="page-title">{{ t("mine.authTitle") }}</h2>
    <p class="post-body">{{ t("mine.authHint") }}</p>
    <form v-if="!keySent" @submit.prevent="sendKey">
      <div class="auth-line">
        <label class="auth-label" for="login-email">{{ t("mine.email") }}</label>
        <input
          id="login-email"
          v-model="email"
          type="email"
          autocomplete="email"
          required
          :placeholder="t('mine.emailPlaceholder')"
          :disabled="busy"
        />
      </div>
      <div class="form-actions">
        <AppButton type="submit" :disabled="busy">{{ t("mine.sendKey") }}</AppButton>
      </div>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </form>
    <form v-else @submit.prevent="confirmKey">
      <p class="post-body">{{ t("mine.keySent") }}</p>
      <label class="auth-label" for="login-key">{{ t("mine.key") }}</label>
      <input
        id="login-key"
        v-model="loginKey"
        type="text"
        autocomplete="one-time-code"
        required
        :placeholder="t('mine.keyPlaceholder')"
        :disabled="busy"
      />
      <div class="form-actions">
        <AppButton type="submit" :disabled="busy">{{ t("mine.enter") }}</AppButton>
        <AppButton variant="secondary" type="button" :disabled="busy" @click="changeEmail">
          {{ t("mine.changeEmail") }}
        </AppButton>
      </div>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </form>
  </section>

  <template v-else>
    <section class="card">
      <div class="profile-head">
        <AppButton
          variant="icon"
          class="profile-avatar"
          :aria-label="t('mine.avatar')"
          :disabled="busy"
          @click="fileInput?.click()"
        >
          <img v-if="session.user.avatarUrl" :src="session.user.avatarUrl" alt="" />
          <UserIcon v-else aria-hidden="true" />
        </AppButton>
        <input
          ref="fileInput"
          class="visually-hidden"
          type="file"
          accept="image/*"
          :aria-label="t('mine.avatar')"
          @change="pickAvatar"
        />
        <form class="profile-name" @submit.prevent="saveName">
          <label class="visually-hidden" for="display-name">{{ t("mine.displayName") }}</label>
          <input
            id="display-name"
            v-model="name"
            type="text"
            maxlength="40"
            :placeholder="t('mine.displayNamePlaceholder')"
            :disabled="busy"
          />
          <AppButton type="submit" :disabled="busy">{{ t("mine.save") }}</AppButton>
        </form>
      </div>
      <dl class="profile-facts">
        <div>
          <dt>{{ t("mine.email") }}</dt>
          <dd>{{ session.user.email }}</dd>
        </div>
        <div>
          <dt>{{ t("mine.level") }}</dt>
          <dd>{{ session.user.level }}</dd>
        </div>
        <div>
          <dt>{{ t("mine.entitlements") }}</dt>
          <dd>{{ entitlementText }}</dd>
        </div>
        <div>
          <dt>{{ t("mine.points") }}</dt>
          <dd>{{ t("mine.pointsBalance", { balance: session.user.pointsBalance }) }}</dd>
        </div>
      </dl>
      <p class="muted profile-note">{{ t("mine.pointsHint") }}</p>
      <div class="form-actions">
        <AppButton variant="secondary" :disabled="busy" @click="leave">{{ t("mine.leave") }}</AppButton>
      </div>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </section>

    <section class="card">
      <h2 class="page-title">{{ t("mine.agent") }}</h2>
      <div class="agent-line">
        <p>{{ agentLine }}</p>
        <AppButton
          variant="icon"
          :aria-label="t('mine.agentRegenerate')"
          :disabled="agentBusy"
          @click="regenerate"
        >
          <RefreshIcon aria-hidden="true" />
        </AppButton>
      </div>
      <p v-if="agentError" class="error" role="alert">{{ agentError }}</p>
      <div class="agent-tips">
        <p class="agent-tips-title">{{ t("mine.agentTipsTitle") }}</p>
        <ul>
          <li>{{ t("mine.agentTipOnce") }}</li>
          <li>{{ t("mine.agentTipRotate") }}</li>
        </ul>
      </div>
      <pre v-if="agentBrief" class="agent-brief">{{ agentBrief }}</pre>
    </section>
  </template>
</template>
