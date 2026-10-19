<script setup>
// 中枢标识。三档栅格，按设备像素比取：小 32（1x）、中 64（2x）、大 128（3x 及以上）。
// 显示尺寸固定，用 x 描述比 w + sizes 更直接，浏览器不会多取一档。
// 换标识时替换同名文件即可。
defineProps({
  size: { type: Number, default: 26 },
});

const srcset = [
  "/logos/xknot-icon-32.png 1x",
  "/logos/xknot-icon-64.png 2x",
  "/logos/xknot-icon-128.png 3x",
].join(", ");
</script>

<template>
  <img
    class="brand-mark-img"
    src="/logos/xknot-icon-64.png"
    :srcset="srcset"
    :width="size"
    :height="size"
    alt=""
    decoding="async"
  />
</template>
