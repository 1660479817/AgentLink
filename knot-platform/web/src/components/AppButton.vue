<script setup>
import { computed } from "vue";

const props = defineProps({
  variant: {
    type: String,
    default: "primary",
    validator: (value) => ["primary", "secondary", "icon"].includes(value),
  },
  type: { type: String, default: "button" },
  disabled: { type: Boolean, default: false },
  to: { type: [String, Object], default: null },
  plain: { type: Boolean, default: false },
});

// RouterLink 没有 disabled 属性：只用 CSS 变灰等于还能点，所以链接形态下自己拦。
const linkDisabled = computed(() => Boolean(props.disabled && props.to));

function onLinkClick(event) {
  if (props.disabled) event.preventDefault();
}
</script>

<template>
  <RouterLink
    v-if="to"
    :to="to"
    class="btn"
    :class="[`btn-${variant}`, { 'is-plain': plain, 'is-disabled': linkDisabled }]"
    :aria-disabled="linkDisabled ? 'true' : undefined"
    :tabindex="linkDisabled ? -1 : undefined"
    @click="onLinkClick"
  >
    <slot />
  </RouterLink>
  <button v-else class="btn" :class="[`btn-${variant}`, { 'is-plain': plain }]" :type="type" :disabled="disabled">
    <slot />
  </button>
</template>
