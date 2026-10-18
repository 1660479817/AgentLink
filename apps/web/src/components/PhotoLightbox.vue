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

const dialog = ref(null);
const current = ref(0);

const count = computed(() => props.photos.length);
const photo = computed(() => props.photos[current.value] || "");

watch(
  () => props.open,
  async (open) => {
    if (open) current.value = clamp(props.index);
    await nextTick();
    const el = dialog.value;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  },
);

onBeforeUnmount(() => {
  const el = dialog.value;
  if (el?.open) el.close();
});

function clamp(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.trunc(value), 0), Math.max(count.value - 1, 0));
}

function step(delta) {
  if (count.value < 2) return;
  current.value = (current.value + delta + count.value) % count.value;
}

function onKeydown(event) {
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    step(-1);
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    step(1);
  }
}

function onCancel(event) {
  event.preventDefault();
  emit("close");
}
</script>

<template>
  <dialog
    ref="dialog"
    class="photo-lightbox"
    :aria-label="t('home.imageViewer')"
    @cancel="onCancel"
    @keydown="onKeydown"
  >
    <div v-if="photo" class="photo-lightbox-stage" @click="emit('close')">
      <img class="photo-lightbox-image" :src="photo" alt="" @click.stop />
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
  </dialog>
</template>
