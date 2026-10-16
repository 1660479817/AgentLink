<script setup>
import { watch } from "vue";
import { RouterLink, useRouter } from "vue-router";
import AppButton from "../components/AppButton.vue";
import AuthForm from "../components/AuthForm.vue";
import { ChatIcon, PlusIcon, SearchIcon } from "../icons/index.js";
import { t } from "../i18n/index.js";
import { useSessionStore } from "../stores/session";

const router = useRouter();
const session = useSessionStore();
const mark = t("app.name").slice(0, 1);
const phrase = t("gate.phrase");
const lead = t("gate.lead");
const phraseAt = lead.indexOf(phrase);
const leadBefore = phraseAt >= 0 ? lead.slice(0, phraseAt) : lead;
const leadPhrase = phraseAt >= 0 ? lead.slice(phraseAt) : "";

const steps = [
  { icon: PlusIcon, label: t("gate.stepPublish"), to: { name: "discover" } },
  { icon: SearchIcon, label: t("gate.stepRead"), to: { name: "discover" } },
  { icon: ChatIcon, label: t("gate.stepWish"), to: { name: "wish" } },
];

watch(
  () => session.user,
  (user) => {
    if (user) router.replace({ name: "discover" });
  }
);
</script>

<template>
  <section class="gate">
    <header class="gate-hero">
      <div class="gate-identity">
        <p class="brand-mark gate-mark" aria-hidden="true">{{ mark }}</p>
        <p class="gate-name">{{ t("app.name") }}</p>
      </div>
      <h1 class="gate-lead">
        {{ leadBefore }}<span v-if="leadPhrase" class="gate-phrase">{{ leadPhrase }}</span>
      </h1>
      <p class="gate-detail">{{ t("gate.detail") }}</p>
    </header>
    <ol class="gate-steps">
      <li v-for="step in steps" :key="step.label" class="gate-step-item">
        <RouterLink class="gate-step" :to="step.to">
          <component :is="step.icon" class="gate-step-icon" aria-hidden="true" />
          <span>{{ step.label }}</span>
        </RouterLink>
      </li>
    </ol>
    <section class="card gate-auth" aria-labelledby="gate-auth-title">
      <h2 id="gate-auth-title" class="page-title">{{ t("mine.authTitle") }}</h2>
      <p class="post-body">{{ t("mine.authHint") }}</p>
      <AuthForm />
    </section>
    <div class="gate-enter">
      <AppButton variant="secondary" to="/discover">{{ t("gate.enter") }}</AppButton>
    </div>
  </section>
</template>
