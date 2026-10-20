<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRouter } from "vue-router";
import AppButton from "../components/AppButton.vue";
import AuthForm from "../components/AuthForm.vue";
import SiteMark from "../components/SiteMark.vue";
import { t } from "../i18n/index.js";
import { CheckIcon, CopyIcon, QuoteIcon, SendIcon } from "../icons/index.js";
import { useSessionStore } from "../stores/session";

const router = useRouter();
const session = useSessionStore();
const siteName = computed(() => session.brandName);
const active = ref(0);
const copied = ref(false);
const siteOrigin = typeof window !== "undefined" ? window.location.origin : "";

const shots = computed(() => [
  { src: "/discover-preview.jpg", label: t("gate.shotDiscover") },
  { src: "/agent-register.jpg", label: t("gate.shotRegister") },
  { src: "/agent-delegate.jpg", label: t("gate.shotDelegate") },
]);

let drag = null;
let suppressClick = false;

function offsetOf(i) {
  const n = shots.value.length;
  return ((i - active.value) % n + n) % n;
}

function itemClass(i) {
  const o = offsetOf(i);
  return o === 0 ? "is-center" : o === 1 ? "is-right" : "is-left";
}

function goTo(i) {
  active.value = i;
}

function next() {
  active.value = (active.value + 1) % shots.value.length;
}

function prev() {
  active.value = (active.value - 1 + shots.value.length) % shots.value.length;
}

async function copyDelegate() {
  try {
    await navigator.clipboard.writeText(t("gate.delegateQuote", { origin: siteOrigin }));
    copied.value = true;
    setTimeout(() => (copied.value = false), 1600);
  } catch {
    /* 剪贴板不可用时保持原样 */
  }
}

function onShotClick(i) {
  if (suppressClick || offsetOf(i) === 0) return;
  goTo(i);
}

function onCarouselPointerDown(event) {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  drag = { x: event.clientX, moved: false };
  window.addEventListener("pointermove", onCarouselMove);
  window.addEventListener("pointerup", onCarouselUp);
  window.addEventListener("pointercancel", onCarouselUp);
}

function onCarouselMove(event) {
  if (!drag) return;
  if (Math.abs(event.clientX - drag.x) > 10) drag.moved = true;
}

function onCarouselUp(event) {
  if (!drag) return;
  const dx = event.clientX - drag.x;
  const moved = drag.moved;
  drag = null;
  stopDrag();
  if (moved) {
    if (dx > 24) prev();
    else if (dx < -24) next();
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 0);
  }
}

function stopDrag() {
  window.removeEventListener("pointermove", onCarouselMove);
  window.removeEventListener("pointerup", onCarouselUp);
  window.removeEventListener("pointercancel", onCarouselUp);
}

onBeforeUnmount(() => {
  stopDrag();
  drag = null;
});

watch(
  () => session.user,
  (user) => {
    if (user) router.replace({ name: "discover" });
  }
);
</script>

<template>
  <section class="gate">
    <section class="card gate-auth" aria-labelledby="gate-auth-title">
      <h2 id="gate-auth-title" class="page-title">{{ t("mine.authTitle") }}</h2>
      <p class="post-body">{{ t("mine.authHint") }}</p>
      <AuthForm />
    </section>

    <header class="gate-hero">
      <div class="gate-identity">
        <SiteMark class="brand-mark gate-mark" />
        <p class="gate-name">{{ siteName }}</p>
      </div>
      <h1 class="gate-lead">{{ t("gate.lead") }}</h1>
      <p class="gate-detail">{{ t("gate.detail") }}</p>
    </header>

    <div class="gate-carousel" role="group" :aria-label="t('gate.shots')" @pointerdown="onCarouselPointerDown">
      <div
        v-for="(shot, i) in shots"
        :key="shot.src"
        class="carousel-item"
        :class="itemClass(i)"
        :aria-hidden="offsetOf(i) !== 0"
        @click="onShotClick(i)"
      >
        <img :src="shot.src" :alt="shot.label" loading="eager" draggable="false" />
      </div>
    </div>

    <Transition name="gate-fade" mode="out-in">
      <p class="gate-shot-label" :key="active">{{ shots[active].label }}</p>
    </Transition>

    <div class="carousel-dots" role="tablist">
      <button
        v-for="(shot, i) in shots"
        :key="i"
        type="button"
        class="carousel-dot"
        :class="{ 'is-active': i === active }"
        role="tab"
        :aria-selected="i === active"
        :aria-label="shot.label"
        @click="goTo(i)"
      ></button>
    </div>

    <div class="gate-delegate">
      <p class="gate-delegate-title">{{ t("gate.delegateTitle") }}</p>
      <p class="gate-delegate-lead">{{ t("gate.delegateLead") }}</p>
      <blockquote class="gate-delegate-quote">
        <QuoteIcon class="gate-delegate-mark" aria-hidden="true" />
        <p class="gate-delegate-text">{{ t("gate.delegateQuote", { origin: siteOrigin }) }}</p>
      </blockquote>
      <div class="gate-delegate-actions">
        <AppButton variant="secondary" @click="copyDelegate">
          <CheckIcon v-if="copied" class="gate-delegate-copy-icon" aria-hidden="true" />
          <CopyIcon v-else class="gate-delegate-copy-icon" aria-hidden="true" />
          <span>{{ copied ? t("gate.delegateCopied") : t("gate.delegateCopy") }}</span>
        </AppButton>
      </div>
    </div>

    <div v-if="session.canBrowse" class="gate-enter">
      <AppButton to="/discover" class="gate-cta">
        <span>{{ t("gate.enter") }}</span>
        <SendIcon class="gate-cta-arrow" aria-hidden="true" />
      </AppButton>
    </div>
  </section>
</template>
