<script setup>
// 橙色面板上的全球纹路：点阵球 + 经纬线 + 一圈缓慢转动的虚线。
// 纯装饰，aria-hidden；不读数据，节点数量变化不会改变它。

const CENTER = 340;
const RADIUS = 262;

const latitudes = [-60, -30, 0, 30, 60].map((lat) => {
  const rad = (lat * Math.PI) / 180;
  const rx = RADIUS * Math.cos(rad);
  return {
    lat,
    cx: CENTER,
    cy: CENTER + RADIUS * Math.sin(rad),
    rx,
    ry: Math.max(rx * 0.2, 2),
  };
});

const longitudes = [30, 60, 90, 120, 150].map((lon) => {
  const rad = (lon * Math.PI) / 180;
  return {
    lon,
    cx: CENTER,
    cy: CENTER,
    rx: Math.max(RADIUS * Math.cos(rad), 1),
    ry: RADIUS,
  };
});
</script>

<template>
  <svg class="globe" viewBox="0 0 700 700" aria-hidden="true" focusable="false">
    <defs>
      <pattern id="globe-dots" width="11" height="11" patternUnits="userSpaceOnUse">
        <circle cx="2.2" cy="2.2" r="1.15" fill="currentColor" />
      </pattern>
      <radialGradient id="globe-fade" cx="42%" cy="38%" r="62%">
        <stop offset="0%" stop-color="#fff" stop-opacity="0.95" />
        <stop offset="62%" stop-color="#fff" stop-opacity="0.5" />
        <stop offset="100%" stop-color="#fff" stop-opacity="0" />
      </radialGradient>
      <mask id="globe-mask">
        <rect width="700" height="700" fill="url(#globe-fade)" />
      </mask>
      <linearGradient id="globe-stroke" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#fff" stop-opacity="0.55" />
        <stop offset="100%" stop-color="#fff" stop-opacity="0.12" />
      </linearGradient>
    </defs>

    <g class="sphere">
      <circle :cx="CENTER" :cy="CENTER" :r="RADIUS" fill="url(#globe-dots)" mask="url(#globe-mask)" />
      <circle :cx="CENTER" :cy="CENTER" :r="RADIUS" class="outline" />

      <g class="grid-lines">
        <ellipse
          v-for="line in latitudes"
          :key="`lat-${line.lat}`"
          :cx="line.cx"
          :cy="line.cy"
          :rx="line.rx"
          :ry="line.ry"
        />
        <ellipse
          v-for="line in longitudes"
          :key="`lon-${line.lon}`"
          :cx="line.cx"
          :cy="line.cy"
          :rx="line.rx"
          :ry="line.ry"
        />
      </g>
    </g>

    <g class="orbit">
      <circle :cx="CENTER" :cy="CENTER" r="316" />
      <circle :cx="CENTER" :cy="CENTER" r="352" class="thin" />
    </g>
  </svg>
</template>

<style scoped>
.globe {
  position: absolute;
  right: -22%;
  bottom: -18%;
  width: min(150%, 900px);
  height: auto;
  color: #ffffff;
  opacity: 0.5;
  pointer-events: none;
  user-select: none;
}

.outline {
  fill: none;
  stroke: url(#globe-stroke);
  stroke-width: 1.2;
}

.grid-lines ellipse {
  fill: none;
  stroke: #ffffff;
  stroke-width: 0.7;
  opacity: 0.2;
}

.orbit circle {
  fill: none;
  stroke: #ffffff;
  stroke-width: 1;
  stroke-dasharray: 3 14;
  opacity: 0.42;
  transform-box: view-box;
  transform-origin: 340px 340px;
  animation: drift 120s linear infinite;
}

.orbit circle.thin {
  stroke-dasharray: 1 10;
  opacity: 0.22;
  animation-duration: 180s;
  animation-direction: reverse;
}

@keyframes drift {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 900px) {
  .globe {
    right: -34%;
    bottom: -24%;
    width: 150%;
    opacity: 0.38;
  }
}

@media (prefers-reduced-motion: reduce) {
  .orbit circle {
    animation: none;
  }
}
</style>
