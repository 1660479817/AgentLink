<script setup>
import { computed, ref } from "vue";
import AppButton from "./AppButton.vue";
import { t } from "../i18n/index.js";
import { useSessionStore } from "../stores/session";

const session = useSessionStore();
const error = ref("");
const busy = ref(false);
const email = ref("");
const loginKey = ref("");
const inviteCode = ref("");
const keySent = ref(false);
const inviteMode = computed(() => session.site.registrationMode === "invite");
const closedMode = computed(() => session.site.registrationMode === "closed");

function showError(err) {
  const key = `error.${err.code}`;
  const message = t(key);
  error.value = message === key ? t("error.request_failed") : message;
}

async function sendKey() {
  error.value = "";
  busy.value = true;
  try {
    await session.requestKey(email.value, inviteCode.value);
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
</script>

<template>
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
    <div v-if="inviteMode" class="auth-line">
      <label class="auth-label" for="login-invite">{{ t("mine.inviteCode") }}</label>
      <input
        id="login-invite"
        v-model="inviteCode"
        type="text"
        autocomplete="off"
        :placeholder="t('mine.invitePlaceholder')"
        :disabled="busy"
      />
    </div>
    <p v-if="inviteMode" class="muted auth-hint">{{ t("mine.inviteHint") }}</p>
    <p v-else-if="closedMode" class="muted auth-hint">{{ t("mine.closedHint") }}</p>
    <div class="form-actions">
      <AppButton type="submit" :disabled="busy || !email.trim()" :aria-busy="busy">
        {{ busy ? t("mine.sendingKey") : t("mine.sendKey") }}
      </AppButton>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </form>
  <form v-else @submit.prevent="confirmKey">
    <p class="post-body">{{ t("mine.keySent") }}</p>
    <label class="auth-label" for="login-key">{{ t("mine.key") }}</label>
    <input
      id="login-key"
      :value="loginKey"
      type="text"
      inputmode="numeric"
      autocomplete="one-time-code"
      maxlength="6"
      pattern="[0-9]{6}"
      required
      :placeholder="t('mine.keyPlaceholder')"
      :disabled="busy"
      @input="loginKey = $event.target.value.replace(/\D/g, '').slice(0, 6)"
    />
    <div class="form-actions">
      <AppButton type="submit" :disabled="busy || loginKey.length !== 6" :aria-busy="busy">
        {{ busy ? t("mine.signingIn") : t("mine.enter") }}
      </AppButton>
      <AppButton variant="secondary" type="button" :disabled="busy" @click="changeEmail">
        {{ t("mine.changeEmail") }}
      </AppButton>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </form>
</template>
