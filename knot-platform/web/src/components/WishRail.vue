<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { BackIcon } from "../icons/index.js";
import { t } from "../i18n/index.js";
import { wishHoursLeft, wishText, wishTo } from "../wishCard.js";

const props = defineProps({
  wishes: { type: Array, default: () => [] },
  label: { type: String, default: "" },
});

const viewport = ref(null);
const canPrev = ref(false);
const canNext = ref(false);
const now = ref(Date.now());
let observer = null;
let clock = null;
let drag = null;

function update() {
  const el = viewport.value;
  if (!el) {
    canPrev.value = false;
    canNext.value = false;
    return;
  }
  canPrev.value = el.scrollLeft > 4;
  canNext.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
}

function scrollRail(direction) {
  const el = viewport.value;
  if (!el) return;
  const distance = Math.max(el.clientWidth * 0.8, 136);
  el.scrollBy({ left: direction * distance, behavior: "smooth" });
}

function endDrag() {
  drag = null;
  viewport.value?.classList.remove("is-dragging");
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
  window.removeEventListener("pointercancel", onPointerUp);
}

function onPointerDown(event) {
  if (event.pointerType !== "mouse" || event.button !== 0) return;
  const el = viewport.value;
  if (!el || el.scrollWidth <= el.clientWidth + 1) return;
  drag = { id: event.pointerId, x: event.clientX, left: el.scrollLeft, moved: false };
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
}

function onPointerMove(event) {
  if (!drag || event.pointerId !== drag.id) return;
  const dx = event.clientX - drag.x;
  if (!drag.moved && Math.abs(dx) < 8) return;
  const el = viewport.value;
  if (!el) return;
  if (!drag.moved) {
    drag.moved = true;
    el.classList.add("is-dragging");
  }
  el.scrollLeft = drag.left - dx;
}

function onPointerUp(event) {
  if (!drag || event.pointerId !== drag.id) return;
  const moved = drag.moved;
  endDrag();
  if (!moved) return;
  const stopClick = (clickEvent) => clickEvent.preventDefault();
  viewport.value?.addEventListener("click", stopClick, { capture: true, once: true });
  setTimeout(() => viewport.value?.removeEventListener("click", stopClick, true), 0);
}

function leftText(wish) {
  const hours = wishHoursLeft(wish, now.value);
  if (hours === null) return t("nav.wish");
  return hours >= 1 ? t("wish.hoursLeft", { n: hours }) : t("wish.endingSoon");
}

onMounted(() => {
  const el = viewport.value;
  if (el && typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(() => update());
    observer.observe(el);
  }
  clock = setInterval(() => {
    now.value = Date.now();
  }, 60 * 1000);
  update();
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
  clearInterval(clock);
  clock = null;
  endDrag();
});

watch(
  () => props.wishes.length,
  async () => {
    await nextTick();
    update();
  }
);
</script>

<template>
  <section v-if="wishes.length" class="card intel-rail wish-rail" :aria-label="label || t('wish.railLabel')">
    <h2 v-if="label" class="wish-rail-title">{{ label }}</h2>
    <div ref="viewport" class="intel-rail-viewport" @scroll="update" @pointerdown="onPointerDown">
      <RouterLink v-for="wish in wishes" :key="wish.id" class="intel-bounty wish-tile" :to="wishTo(wish)">
        <span v-if="wish.mine && wish.responseCount != null" class="wish-tile-count">
          {{ t("home.wishReplyCount", { n: wish.responseCount || 0 }) }}
        </span>
        <span class="intel-bounty-body">
          <span class="intel-bounty-text">{{ wishText(wish, t("nav.wish")) }}</span>
        </span>
        <span class="intel-bounty-reward">{{ leftText(wish) }}</span>
      </RouterLink>
    </div>
    <button
      v-if="canPrev"
      type="button"
      class="intel-rail-arrow intel-rail-arrow-prev"
      :aria-label="t('home.storyPrev')"
      @click="scrollRail(-1)"
    >
      <BackIcon aria-hidden="true" />
    </button>
    <button
      v-if="canNext"
      type="button"
      class="intel-rail-arrow intel-rail-arrow-next"
      :aria-label="t('home.storyNext')"
      @click="scrollRail(1)"
    >
      <BackIcon class="intel-rail-arrow-forward" aria-hidden="true" />
    </button>
  </section>
</template>
