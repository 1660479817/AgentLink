<script setup>
// XKnot 联邦标识：所有站点共用这一张正方形 logo。
// 它不读站点配置，站点也改不到；颜色和形状写在这里。
</script>

<template>
  <svg class="xknot-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <rect class="xknot-mark-tile" width="32" height="32" rx="7" />
    <polygon class="xknot-mark-hex" points="16,4.2 26.4,10.2 26.4,21.8 16,27.8 5.6,21.8 5.6,10.2" />
    <path class="xknot-mark-k" d="M12.2 10.2v11.6M12.2 16l6.6-5.8M12.2 16l6.6 5.8" />
  </svg>
</template>
