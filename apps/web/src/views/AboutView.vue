<script setup>
import AppButton from "../components/AppButton.vue";
import { t } from "../i18n/index.js";

const mark = t("app.name").slice(0, 1);
const phrase = t("about.phrase");
const lead = t("about.lead");
const phraseAt = lead.indexOf(phrase);
const leadBefore = phraseAt >= 0 ? lead.slice(0, phraseAt) : lead;
const leadPhrase = phraseAt >= 0 ? lead.slice(phraseAt) : "";
</script>

<template>
  <section class="card about-card">
    <div class="about-identity">
      <p class="brand-mark about-mark" aria-hidden="true">{{ mark }}</p>
      <h1 class="about-name">{{ t("app.name") }}</h1>
    </div>
    <p class="about-lead">{{ leadBefore }}<span v-if="leadPhrase" class="about-phrase">{{ leadPhrase }}</span></p>
    <p class="about-detail">{{ t("about.detail") }}</p>
    <div class="form-actions">
      <AppButton to="/mine">{{ t("about.login") }}</AppButton>
      <AppButton variant="secondary" to="/">{{ t("about.enter") }}</AppButton>
    </div>
  </section>
</template>
