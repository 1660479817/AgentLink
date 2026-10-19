<script setup>
defineProps({
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
</script>

<template>
  <RouterLink v-if="to" :to="to" class="btn" :class="[`btn-${variant}`, { 'is-plain': plain }]">
    <slot />
  </RouterLink>
  <button v-else class="btn" :class="[`btn-${variant}`, { 'is-plain': plain }]" :type="type" :disabled="disabled">
    <slot />
  </button>
</template>
