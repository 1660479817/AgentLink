<script setup>
import { ref } from "vue";
import AppButton from "./AppButton.vue";
import { CloseIcon } from "../icons/index.js";
import { t } from "../i18n/index.js";

const STORAGE_KEY = "knot.rememberLogin.hidden";
const mark = t("app.name").slice(0, 1);

function readHidden() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

const visible = ref(!readHidden());

function hide() {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // storage unavailable; still hide for this view
  }
  visible.value = false;
}
</script>

<template>
  <section v-if="visible" class="card remember-card" aria-labelledby="remember-login-title">
    <div class="remember-head">
      <span class="brand-mark remember-mark" aria-hidden="true">{{ mark }}</span>
      <svg class="remember-art" viewBox="0 0 124 88" aria-hidden="true">
        <rect x="16" y="2" width="92" height="64" rx="8" fill="#dfe1e6" />
        <rect x="24" y="10" width="76" height="48" rx="3" fill="#ffffff" />
        <circle cx="62" cy="28" r="9" fill="#e4e6eb" />
        <circle cx="62" cy="25.6" r="2.7" fill="#65676b" />
        <path d="M55.2 34.8c1.1-3.1 3.5-4.6 6.8-4.6s5.7 1.5 6.8 4.6" fill="#65676b" />
        <rect x="42" y="44" width="40" height="7" rx="3.5" fill="#42b72a" />
        <path d="M54 66h16l4 8H50Z" fill="#cfd2d6" />
        <rect x="40" y="74" width="44" height="6" rx="3" fill="#b0b3b8" />
      </svg>
    </div>
    <h2 id="remember-login-title" class="remember-title">{{ t("remember.title") }}</h2>
    <p class="remember-copy">{{ t("remember.body") }}</p>
    <div class="remember-actions">
      <AppButton class="remember-confirm" @click="hide">{{ t("remember.confirm") }}</AppButton>
      <AppButton variant="secondary" @click="hide">{{ t("remember.later") }}</AppButton>
    </div>
    <AppButton class="remember-close" variant="icon" plain :aria-label="t('remember.close')" @click="hide">
      <CloseIcon class="remember-x" aria-hidden="true" />
    </AppButton>
  </section>
</template>
