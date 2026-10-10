<script setup>
defineProps({
  to: { type: String, required: true },
  icon: { type: Object, required: true },
  label: { type: String, required: true },
  end: { type: Boolean, default: false },
});
</script>

<template>
  <RouterLink :to="to" custom v-slot="{ href, navigate, isActive, isExactActive }">
    <a
      :href="href"
      class="nav-link"
      :class="{ 'is-active': end ? isExactActive : isActive }"
      @click="navigate"
    >
      <component :is="icon" class="nav-icon" aria-hidden="true" />
      <span>{{ label }}</span>
    </a>
  </RouterLink>
</template>
