<script setup>
import GlobeIcon from "../icons/GlobeIcon.vue";
import { LOCALES, localeHref } from "../lib/i18n.js";

defineProps({
  locale: { type: String, required: true },
  t: { type: Function, required: true },
  variant: { type: String, default: "light" },
});
</script>

<template>
  <nav class="langs" :class="{ accent: variant === 'accent' }" :aria-label="t('portal.switchLanguage')">
    <GlobeIcon class="globe" aria-hidden="true" />
    <a
      v-for="code in LOCALES"
      :key="code"
      :href="localeHref(code)"
      :hreflang="code"
      :lang="code"
      :title="t(`localeName.${code}`)"
      :aria-label="t(`localeName.${code}`)"
      :aria-current="code === locale ? 'page' : undefined"
      class="lang"
      :class="{ active: code === locale }"
    >
      {{ t(`locale.${code}`) }}
    </a>
  </nav>
</template>

<style scoped>
.langs {
  display: inline-flex;
  align-items: center;
  gap: 0.15rem;
  padding: 0.2rem;
  border: 1px solid var(--line);
  border-radius: 2px;
  background: var(--surface);
}

.globe {
  margin-inline: 0.4rem 0.2rem;
  font-size: 0.9rem;
  color: var(--dim);
}

.lang {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 34px;
  min-height: 30px;
  padding: 0.2rem 0.5rem;
  border-radius: 1px;
  color: var(--dim);
  font-family: var(--font-mono);
  font-size: 0.7rem;
  letter-spacing: 0.1em;
  text-decoration: none;
  transition:
    color 180ms ease,
    background 180ms ease;
}

.lang:hover {
  color: var(--ink);
  background: var(--surface-soft);
}

.lang.active {
  color: #ffffff;
  background: var(--accent);
  font-weight: 600;
}

@media (max-width: 640px) {
  /* 手机上语种是整组并排的链接，命中区抬到 44 才按得准。 */
  .lang {
    min-width: 44px;
    min-height: 44px;
  }
}

/* 橙色面板上的同一组链接：白边、透明底、白字。 */
.langs.accent {
  border-color: rgba(255, 255, 255, 0.42);
  background: rgba(255, 255, 255, 0.1);
}

.langs.accent .globe {
  color: rgba(255, 255, 255, 0.75);
}

.langs.accent .lang {
  color: rgba(255, 255, 255, 0.82);
}

.langs.accent .lang:hover {
  color: #ffffff;
  background: rgba(255, 255, 255, 0.16);
}

.langs.accent .lang.active {
  color: #b53f08;
  background: #ffffff;
}
</style>
