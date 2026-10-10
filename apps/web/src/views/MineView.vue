<script setup>
import { computed, onMounted, ref, watch } from "vue";
import AppButton from "../components/AppButton.vue";
import { UserIcon } from "../icons";
import { t } from "../i18n";
import { updateProfile, uploadImage } from "../api";
import { useSessionStore } from "../stores/session";

const session = useSessionStore();
const error = ref("");
const busy = ref(false);
const name = ref("");
const email = ref("");
const loginKey = ref("");
const keySent = ref(false);
const fileInput = ref(null);

onMounted(() => {
  if (session.user) session.load();
});

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
      <p class="post-body">{{ t("mine.agentHint") }}</p>
      <div class="form-actions">
        <AppButton variant="secondary" to="/delegate">{{ t("mine.agentOpen") }}</AppButton>
      </div>
    </section>
  </template>
</template>
