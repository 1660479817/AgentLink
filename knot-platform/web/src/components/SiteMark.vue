<script setup>
import { computed } from "vue";
import { useSessionStore } from "../stores/session";

// 站点自己的标识（双品牌里的个人品牌）。
// 档案里配了 logo 就用那张图；没配就退回站点名首字。
// 外层 class 由调用方给，尺寸仍按原样生效。
const props = defineProps({
  text: {
    type: String,
    default: "",
  },
});

const session = useSessionStore();
const logo = computed(() => session.siteLogo);
const mark = computed(() => Array.from(String(props.text || session.brandName))[0] || "K");
</script>

<template>
  <span class="site-mark" aria-hidden="true">
    <img v-if="logo" class="site-mark-image" :src="logo" alt="" />
    <template v-else>{{ mark }}</template>
  </span>
</template>
