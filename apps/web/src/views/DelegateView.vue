<script setup>
import { onMounted, ref } from "vue";
import AppButton from "../components/AppButton.vue";
import { createDelegation, getDelegation, revokeDelegation } from "../api.js";
import { t } from "../i18n/index.js";

const delegated = ref(false);
const token = ref("");
const error = ref("");
const busy = ref(false);

onMounted(load);

async function load() {
  const data = await getDelegation();
  delegated.value = data.delegated;
}

async function create() {
  error.value = "";
  busy.value = true;
  try {
    const data = await createDelegation();
    token.value = data.token;
    delegated.value = true;
  } catch {
    error.value = t("error.request_failed");
  } finally {
    busy.value = false;
  }
}

async function revoke() {
  error.value = "";
  busy.value = true;
  try {
    await revokeDelegation();
    delegated.value = false;
    token.value = "";
  } catch {
    error.value = t("error.request_failed");
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="card">
    <h1 class="page-title">{{ t("delegate.title") }}</h1>
    <p>{{ t("delegate.body") }}</p>
    <p v-if="delegated" class="muted">{{ t("delegate.active") }}</p>
    <p v-if="token" class="muted">{{ t("delegate.tokenHint") }}</p>
    <textarea v-if="token" :value="token" rows="3" readonly />
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div class="form-actions">
      <AppButton :disabled="busy" @click="create">{{ t("delegate.create") }}</AppButton>
      <AppButton v-if="delegated" variant="secondary" :disabled="busy" @click="revoke">
        {{ t("delegate.revoke") }}
      </AppButton>
    </div>
  </section>
</template>
