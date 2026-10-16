<script setup>
import { computed, onMounted, onUnmounted, ref } from "vue";
import AppButton from "./AppButton.vue";
import { CheckIcon, ChevronDownIcon, LanguageIcon } from "../icons/index.js";
import { t } from "../i18n/index.js";
import { LOCALES } from "../locale.js";
import { updateProfile } from "../api.js";
import { useLocaleStore } from "../stores/locale.js";
import { useSessionStore } from "../stores/session.js";

const props = defineProps({
  variant: {
    type: String,
    default: "field",
  },
});

const locale = useLocaleStore();
const session = useSessionStore();
const open = ref(false);
const root = ref(null);
const error = ref("");
const busy = ref(false);

const currentName = computed(() => {
  const item = LOCALES.find((entry) => entry.id === locale.current);
  return item ? t(item.nameKey) : locale.current;
});

function onDoc(event) {
  if (!open.value) return;
  if (root.value && !root.value.contains(event.target)) open.value = false;
}

function onKey(event) {
  if (event.key === "Escape") open.value = false;
}

onMounted(() => {
  document.addEventListener("pointerdown", onDoc);
  document.addEventListener("keydown", onKey);
});

onUnmounted(() => {
  document.removeEventListener("pointerdown", onDoc);
  document.removeEventListener("keydown", onKey);
});

function showError(err) {
  const key = `error.${err?.code}`;
  const message = t(key);
  error.value = message === key ? t("error.request_failed") : message;
}

async function choose(id) {
  error.value = "";
  const snapshot = { locale: locale.current, pinned: locale.pinned };
  const result = locale.choose(id);
  if (!result) {
    open.value = false;
    return;
  }
  if (!session.user) {
    open.value = false;
    return;
  }
  busy.value = true;
  try {
    const data = await updateProfile({ locale: id });
    session.user = data.user;
    open.value = false;
  } catch (err) {
    locale.restore(snapshot);
    showError(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div ref="root" class="locale" :class="`locale-${variant}`">
    <AppButton
      v-if="variant === 'menu'"
      variant="icon"
      :aria-label="t('locale.current', { name: currentName })"
      :aria-expanded="open"
      aria-haspopup="listbox"
      :disabled="busy"
      @click="open = !open"
    >
      <LanguageIcon class="nav-icon" weight="header" aria-hidden="true" />
    </AppButton>
    <button
      v-else
      type="button"
      class="locale-trigger"
      :aria-label="t('locale.current', { name: currentName })"
      :aria-expanded="open"
      aria-haspopup="listbox"
      :disabled="busy"
      @click="open = !open"
    >
      <LanguageIcon class="locale-trigger-icon" aria-hidden="true" />
      <span class="locale-trigger-name">{{ currentName }}</span>
      <ChevronDownIcon class="locale-trigger-chevron" aria-hidden="true" />
    </button>

    <div v-if="open || error" class="locale-popover">
      <p class="locale-popover-title">{{ t("locale.label") }}</p>
      <ul v-if="open" class="locale-options" role="listbox" :aria-label="t('locale.label')">
        <li v-for="item in LOCALES" :key="item.id">
          <button
            type="button"
            class="locale-option"
            role="option"
            :aria-selected="item.id === locale.current"
            :disabled="busy"
            @click="choose(item.id)"
          >
            <span class="locale-option-name">{{ t(item.nameKey) }}</span>
            <CheckIcon
              v-if="item.id === locale.current"
              class="locale-option-check"
              aria-hidden="true"
            />
          </button>
        </li>
      </ul>
      <p v-if="error" class="error locale-error" role="alert">{{ error }}</p>
    </div>
  </div>
</template>
