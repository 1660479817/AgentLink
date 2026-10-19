<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import AppButton from "./AppButton.vue";
import { t } from "../i18n/index.js";
import { BackIcon, CloseIcon } from "../icons/index.js";

const props = defineProps({
  photos: { type: Array, default: () => [] },
  open: { type: Boolean, default: false },
  index: { type: Number, default: 0 },
});

const emit = defineEmits(["close"]);

const panel = ref(null);
const current = ref(0);
const count = computed(() => props.photos.length);
const photo = computed(() => props.photos[current.value] || "");

let restoreFocus = null;

function clamp(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.trunc(value), 0), Math.max(count.value - 1, 0));
}

function step(delta) {
  if (count.value < 2) return;
  current.value = (current.value + delta + count.value) % count.value;
}

function onKeydown(event) {
  if (event.key === "Escape") emit("close");
  else if (event.key === "ArrowLeft") step(-1);
  else if (event.key === "ArrowRight") step(1);
}

function release() {
  document.body.classList.remove("is-lightbox");
  window.removeEventListener("keydown", onKeydown);
  restoreFocus?.focus?.();
  restoreFocus = null;
}

watch(
  () => props.photos,
  () => {
    current.value = clamp(current.value);
  },
);

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      release();
      return;
    }
    current.value = clamp(props.index);
    restoreFocus = document.activeElement;
    document.body.classList.add("is-lightbox");
    window.addEventListener("keydown", onKeydown);
    await nextTick();
    panel.value?.focus();
  },
);

onBeforeUnmount(release);
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open && photo"
      ref="panel"
      class="photo-lightbox"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      :aria-label="t('home.imageViewer')"
      @click="emit('close')"
    >
      <img class="photo-lightbox-image" :src="photo" alt="" />
      <p v-if="count > 1" class="photo-lightbox-count">{{ t("home.imageCount", { n: current + 1, total: count }) }}</p>
      <AppButton
        class="photo-lightbox-close"
        variant="icon"
        type="button"
        :aria-label="t('home.imageClose')"
        @click.stop="emit('close')"
      >
        <CloseIcon aria-hidden="true" />
      </AppButton>
      <template v-if="count > 1">
        <AppButton
          class="photo-lightbox-nav is-prev"
          variant="icon"
          type="button"
          :aria-label="t('home.imagePrev')"
          @click.stop="step(-1)"
        >
          <BackIcon aria-hidden="true" />
        </AppButton>
        <AppButton
          class="photo-lightbox-nav is-next"
          variant="icon"
          type="button"
          :aria-label="t('home.imageNext')"
          @click.stop="step(1)"
        >
          <BackIcon aria-hidden="true" />
        </AppButton>
      </template>
    </div>
  </Teleport>
</template>
