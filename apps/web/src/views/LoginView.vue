<script setup>
import { ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { authRequest, authVerify } from "../api.js";
import { t } from "../i18n/index.js";
import { useSessionStore } from "../stores/session";
import { useInfoBufferStore } from "../stores/infoBuffer";

const route = useRoute();
const router = useRouter();
const session = useSessionStore();
const buffer = useInfoBufferStore();

const email = ref("");
const code = ref("");
const step = ref("email");
const error = ref("");
const busy = ref(false);

watch(
  () => session.user,
  (u) => {
    if (u) {
      const redirect = route.query.redirect?.toString() || "/";
      router.replace(redirect);
    }
  },
  { immediate: true }
);

async function sendCode() {
  error.value = "";
  busy.value = true;
  try {
    await authRequest(email.value.trim());
    step.value = "code";
  } catch (err) {
    error.value = err.code || err.message;
  } finally {
    busy.value = false;
  }
}

async function verify() {
  error.value = "";
  busy.value = true;
  try {
    const data = await authVerify(email.value.trim(), code.value.trim());
    session.setUser(data.user);
    await buffer.invalidate();
  } catch (err) {
    error.value = err.code || err.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="auth-shell">
    <div class="card auth-panel">
      <p class="chip">{{ t("login.tagline") }}</p>
      <h2>{{ t("login.title") }}</h2>
      <p v-if="route.query.reason === 'REGISTER_REQUIRED'" class="error" role="alert">
        {{ t("login.registerRequired") }}
      </p>
      <p class="muted">{{ t("login.hint") }}</p>
      <form v-if="step === 'email'" @submit.prevent="sendCode">
        <label for="login-email">{{ t("login.emailLabel") }}</label>
        <input
          id="login-email"
          v-model="email"
          name="email"
          type="email"
          autocomplete="email"
          spellcheck="false"
          :placeholder="t('login.emailPlaceholder')"
          required
        />
        <button type="submit" :disabled="busy">{{ t("login.sendCode") }}</button>
      </form>
      <form v-else @submit.prevent="verify">
        <p class="muted">{{ t("login.sentTo", { email }) }}</p>
        <label for="login-code">{{ t("login.codeLabel") }}</label>
        <input
          id="login-code"
          v-model="code"
          name="code"
          type="text"
          inputmode="numeric"
          autocomplete="one-time-code"
          spellcheck="false"
          :placeholder="t('login.codePlaceholder')"
          maxlength="6"
          required
        />
        <div class="form-actions">
          <button type="submit" :disabled="busy">{{ t("login.verify") }}</button>
          <button type="button" class="secondary" @click="step = 'email'">
            {{ t("login.changeEmail") }}
          </button>
        </div>
      </form>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <p class="muted" style="margin-top: 1rem; margin-bottom: 0">{{ t("login.devLogHint") }}</p>
    </div>
  </div>
</template>
