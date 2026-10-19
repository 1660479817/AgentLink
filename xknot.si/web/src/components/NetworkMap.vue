// 联邦地图：把清单里的节点按国家中心点放到一张世界底图上。
//
// 为什么不是环形图：环上的位置只跟清单顺序有关，看起来像「一圈站点」，
// 看不出联邦在哪些时区、哪些大陆。这里位置由经纬度决定，
// 相邻的节点之间连一条弧，读出来才是一张网，而不是一份列表。

<script setup>
import { computed } from "vue";

import { centroidOf, LAND_PATH, project, WORLD } from "../lib/world.js";

const props = defineProps({
  items: { type: Array, default: () => [] },
  activeId: { type: String, default: null },
  // 联邦中心的 logo。为空时画占位标记。
  logo: { type: String, default: null },
  t: { type: Function, required: true },
});

const emit = defineEmits(["select"]);

const VIEW = { width: WORLD.width, height: WORLD.height };

// 底图：经线每 30°、纬线每 30°，裁剪范围内只画得下四条纬线。
const GRATICULE = (() => {
  const lines = [];
  for (let lon = -150; lon <= 150; lon += 30) {
    const x = project(lon, 0).x;
    lines.push(`M${x.toFixed(1)} 0V${VIEW.height}`);
  }
  for (let lat = -30; lat <= 60; lat += 30) {
    const y = project(0, lat).y;
    lines.push(`M0 ${y.toFixed(1)}H${VIEW.width}`);
  }
  return lines.join("");
})();

const EQUATOR = project(0, 0).y.toFixed(1);

// 同一片区域可能有多个节点（比如欧洲两个）。挤在一起就上下错开，
// 让每个点都点得到，而不是叠成一个。
function spread(points) {
  const placed = [];
  const minY = 10;
  const maxY = VIEW.height - 10;
  for (const point of points) {
    let next = { ...point };
    let tryIndex = 0;
    while (placed.some((other) => Math.hypot(other.x - next.x, other.y - next.y) < 30) && tryIndex < 8) {
      const step = 17 * (tryIndex + 1);
      const direction = tryIndex % 2 === 0 ? -1 : 1;
      next = {
        ...point,
        y: Math.min(maxY, Math.max(minY, point.y + direction * step)),
      };
      tryIndex += 1;
    }
    placed.push(next);
  }
  return placed;
}

const placed = computed(() => {
  const points = [];
  const orphans = [];
  for (const item of props.items) {
    const center = centroidOf(item.regions);
    if (!center) {
      orphans.push(item);
      continue;
    }
    const point = project(center.lon, center.lat);
    if (!point) {
      orphans.push(item);
      continue;
    }
    points.push({ ...item, x: point.x, y: point.y });
  }
  return spread(points);
});

const unplaced = computed(() => {
  const out = [];
  for (const item of props.items) {
    if (!centroidOf(item.regions)) out.push(item);
  }
  return out;
});

// 联邦中心：不落在任何经纬度上，悬在地图上方。所有节点朝它连。
// 位置只跟画布有关，跟清单顺序无关，所以加站、减站都不会让中心漂移。
// y 取在画布上缘之上：所有弧线的交汇点藏在徽标后面，不在地图上留下一个结。
const HUB = { x: VIEW.width / 2, y: -8 };

// 每个节点一条弧线飞向联邦中心。弧线朝中轴外侧鼓一点，
// 十根线才不会在中心下方挤成一根柱子。
const links = computed(() =>
  placed.value.map((point, index) => ({
    id: point.id,
    status: point.status,
    d: fanArc(point),
    // 延迟错开，避免十根线上的光点同时起步。
    delay: `${(-(index * 0.9)).toFixed(1)}s`,
  }))
);

function fanArc(point) {
  const dx = HUB.x - point.x;
  const dy = HUB.y - point.y;
  const distance = Math.hypot(dx, dy) || 1;
  // 单位法线，再按节点在中轴的哪一侧取向外的那一边。
  const nx = -dy / distance;
  const ny = dx / distance;
  const outward = point.x >= HUB.x ? 1 : -1;
  const sign = nx * outward >= 0 ? 1 : -1;
  const bow = Math.min(52, distance * 0.13);
  const cx = (point.x + HUB.x) / 2 + nx * sign * bow;
  const cy = (point.y + HUB.y) / 2 + ny * sign * bow;
  return `M${point.x.toFixed(1)} ${point.y.toFixed(1)}Q${cx.toFixed(1)} ${cy.toFixed(1)} ${HUB.x} ${HUB.y}`;
}

const online = computed(
  () => props.items.filter((item) => item.status === "up" || item.status === "degraded").length
);

// 图例只列出现过的状态，颜色之外再给文字和数量。
const legend = computed(() =>
  ["up", "degraded", "down", "unknown"]
    .map((key) => ({ key, count: props.items.filter((item) => item.status === key).length }))
    .filter((entry) => entry.count > 0)
);

const ariaLabel = computed(() =>
  props.t("map.label", { total: props.items.length, online: online.value })
);

function label(item) {
  return `${item.name} · ${item.groupLabel} · ${props.t(`status.${item.status}`)} · ${item.localTime}`;
}

function place(point) {
  return {
    left: `${((point.x / VIEW.width) * 100).toFixed(2)}%`,
    top: `${((point.y / VIEW.height) * 100).toFixed(2)}%`,
  };
}

// 标签默认在点的外侧：下半张图朝上、上半张图朝下，靠边的改左右对齐。
function tipClass(point) {
  return [
    point.y > VIEW.height * 0.42 ? "above" : "below",
    point.x < VIEW.width * 0.12 ? "left" : point.x > VIEW.width * 0.88 ? "right" : "center",
  ];
}

function activate(id) {
  emit("select", id);
}
</script>

<template>
  <section class="map" role="group" :aria-label="ariaLabel">
    <header class="map-head">
        <h2 class="map-kicker">
          <span class="map-ping" aria-hidden="true" />
          {{ t("map.title") }}
        </h2>
      <ul class="legend">
        <li v-for="entry in legend" :key="entry.key" :class="entry.key">
          <i class="legend-dot" aria-hidden="true" />
          <span>{{ t(`status.${entry.key}`) }}</span>
          <span class="legend-count">{{ entry.count }}</span>
        </li>
      </ul>
    </header>

    <div class="stage">
      <svg
        class="world"
        :viewBox="`0 0 ${VIEW.width} ${VIEW.height}`"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <pattern id="xk-land-dots" width="11" height="11" patternUnits="userSpaceOnUse">
            <circle class="land-dot" cx="2.4" cy="2.4" r="1.55" />
          </pattern>
        </defs>

        <path class="graticule" :d="GRATICULE" />
        <line class="equator" x1="0" :y1="EQUATOR" :x2="VIEW.width" :y2="EQUATOR" />

        <path class="land" :d="LAND_PATH" />
        <path class="land-edge" :d="LAND_PATH" vector-effect="non-scaling-stroke" />

        <g class="links">
          <g v-for="link in links" :key="link.id">
            <path
              class="link"
              :class="[link.status, { active: activeId === link.id }]"
              :d="link.d"
              vector-effect="non-scaling-stroke"
            />
            <path
              class="glint"
              :class="[link.status, { active: activeId === link.id }]"
              :d="link.d"
              pathLength="100"
              :style="{ animationDelay: link.delay }"
              vector-effect="non-scaling-stroke"
            />
          </g>
        </g>
      </svg>

      <!-- 联邦中心：悬在地图上方的占位。传 logo 就把六边形换成图片，位置不变。 -->
      <div class="hub">
        <span class="hub-shadow" aria-hidden="true" />
        <span class="hub-body">
          <img v-if="logo" class="hub-logo" :src="logo" alt="" />
          <span v-else class="hub-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              <path
                d="M12 2.6 20.4 7v10L12 21.4 3.6 17V7L12 2.6Z"
                fill="none"
                stroke="currentColor"
                stroke-width="1.3"
              />
              <circle cx="12" cy="12" r="2.5" fill="currentColor" />
            </svg>
          </span>
          <span class="hub-text">
            <span class="hub-name">XKNOT</span>
            <span class="hub-role">{{ t("map.hub") }}</span>
          </span>
        </span>
      </div>

      <button
        v-for="point in placed"
        :key="point.id"
        type="button"
        class="pin"
        :class="[point.status, { muted: !point.visible, active: point.id === activeId }]"
        :style="place(point)"
        :aria-label="label(point)"
        @click="activate(point.id)"
      >
        <span class="dot" aria-hidden="true"><span class="halo" /></span>
        <span class="tag" :class="{ flip: point.x > VIEW.width * 0.78 }" aria-hidden="true">
          {{ point.shortName || point.name }}
        </span>
        <span class="tip" :class="tipClass(point)" aria-hidden="true">
          <span class="tip-name">{{ point.name }}</span>
          <span class="tip-meta">{{ point.groupLabel }} · {{ point.localTime }}</span>
        </span>
      </button>
    </div>

    <div class="map-foot">
      <p class="hint">{{ t("map.hint") }}</p>
      <p v-if="unplaced.length" class="unplaced">
        <span class="unplaced-label">{{ t("map.global") }}</span>
        <button
          v-for="point in unplaced"
          :key="point.id"
          type="button"
          class="unplaced-chip"
          :class="point.status"
          :aria-label="label(point)"
          @click="activate(point.id)"
        >
          <i class="chip-dot" aria-hidden="true" />
          {{ point.name }}
        </button>
      </p>
    </div>
  </section>
</template>

<style scoped>
.map {
  width: 100%;
  min-width: 0;
  container-type: inline-size;
}

.map-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem 1rem;
  flex-wrap: wrap;
  padding-bottom: 0.45rem;
}

.map-kicker {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.66rem;
  font-weight: 500;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--muted);
}

.map-ping {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--ok);
  box-shadow: 0 0 0 3px rgba(11, 122, 84, 0.14);
}

.stage {
  position: relative;
  width: 100%;
  aspect-ratio: 960 / 379;
  /* 上方留出联邦中心悬空的位置，它和地图不是同一层 */
  margin-top: 3.3rem;
}

.world {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
}

/* 经纬网 */
.graticule {
  fill: none;
  stroke: var(--grid-line);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

.equator {
  stroke: var(--tier-line);
  stroke-width: 1;
  stroke-dasharray: 3 5;
  vector-effect: non-scaling-stroke;
}

/* 陆地：点阵填充，和右栏的点阵球同一个语汇 */
.land {
  fill: url(#xk-land-dots);
}

.land-dot {
  fill: var(--map-land);
}

.land-edge {
  fill: none;
  stroke: var(--map-edge);
  stroke-width: 1;
}

/* 链路：半透明橙色长划线，从每个节点拉到联邦中心。
   颜色本身带 alpha，不靠整条 path 压不透明度，虚线才不会糊成一团。 */
.link {
  fill: none;
  stroke: var(--map-link-line);
  stroke-width: 1;
  stroke-dasharray: 10 5;
}

.link.active {
  stroke: var(--map-link-line-active);
  stroke-width: 1.4;
  stroke-dasharray: 12 4;
}

/* 不可达的站线也留着，只是更淡：网还在，只是那一刻没应答 */
.link.down {
  stroke: var(--map-link-line);
  opacity: 0.45;
}

/* 沿线飞向中心的一小段亮色，只是韵律，不是第二根线 */
.glint {
  fill: none;
  stroke: var(--map-link-spark);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-dasharray: 6 94;
  opacity: 0;
  animation: fly 6.5s linear infinite;
}

.glint.active {
  opacity: 1;
  animation-duration: 2.6s;
}

.glint.down {
  animation: none;
}

/* 光点从节点飞向联邦中心：pathLength 已归一为 100，偏移正好一圈 */
@keyframes fly {
  0% {
    stroke-dashoffset: 0;
    opacity: 0;
  }
  8%,
  78% {
    opacity: 0.75;
  }
  100% {
    stroke-dashoffset: -100;
    opacity: 0;
  }
}

/* 联邦中心：悬在地图上方，不落经纬度。
   底下一层投影落在底图上，随呼吸收放，读起来才是「浮着」。 */
.hub {
  position: absolute;
  z-index: 3;
  top: 0;
  left: 50%;
  transform: translate(-50%, -74%);
  pointer-events: none;
}

.hub-body {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.8rem 0.4rem 0.55rem;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  background: var(--surface);
  box-shadow: var(--hub-shadow);
  animation: hover 7s ease-in-out infinite;
}

.hub-shadow {
  position: absolute;
  left: 50%;
  bottom: -16px;
  width: 76%;
  height: 14px;
  transform: translateX(-50%);
  border-radius: 50%;
  background: radial-gradient(50% 50% at 50% 50%, var(--hub-cast), transparent 70%);
  filter: blur(4px);
  animation: cast 7s ease-in-out infinite;
}

.hub-mark {
  display: block;
  width: 22px;
  height: 22px;
  color: var(--map-link);
}

.hub-mark svg {
  display: block;
  width: 100%;
  height: 100%;
}

.hub-logo {
  display: block;
  width: 22px;
  height: 22px;
  object-fit: contain;
}

.hub-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  line-height: 1.05;
}

.hub-name {
  font-family: var(--font-display);
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.2em;
  color: var(--ink);
}

.hub-role {
  font-family: var(--font-mono);
  font-size: 0.55rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--muted);
}

@keyframes hover {
  50% {
    transform: translateY(-3px);
  }
}

@keyframes cast {
  50% {
    transform: translateX(-50%) scaleX(0.9);
    opacity: 0.72;
  }
}

/* 节点按钮 */
.pin {
  position: absolute;
  z-index: 2;
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  padding: 0;
  margin: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--unknown);
  transform: translate(-50%, -50%);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.pin.up {
  color: var(--ok);
}
.pin.degraded {
  color: var(--warn);
}
.pin.down {
  color: var(--bad);
}
.pin.unknown {
  color: var(--unknown);
}

.pin.muted {
  opacity: 0.32;
}

/* 点名常驻：宽屏上让地图自己说得出「哪几个站」，不用靠悬停 */
.tag {
  display: none;
  position: absolute;
  left: 26px;
  top: 50%;
  transform: translateY(-50%);
  font-family: var(--font-mono);
  font-size: 0.62rem;
  letter-spacing: 0.04em;
  color: var(--muted);
  white-space: nowrap;
  pointer-events: none;
  /* 字压在点阵陆地上，用底色描一圈才读得清 */
  text-shadow:
    0 0 3px var(--surface),
    0 0 2px var(--surface),
    0 0 1px var(--surface);
}

.tag.flip {
  left: auto;
  right: 26px;
}

/* 图够宽才点名：窄屏点挨得近，标签会打架 */
@container (min-width: 620px) {
  .tag {
    display: block;
  }
}

.dot {
  position: relative;
  display: grid;
  place-items: center;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 0 1.5px var(--surface);
  transition: transform 180ms ease;
}

.pin.up .dot,
.pin.degraded .dot {
  box-shadow:
    0 0 0 1.5px var(--surface),
    0 0 12px -1px currentColor;
}

.halo {
  position: absolute;
  inset: -6px;
  border-radius: 50%;
  border: 1px solid currentColor;
  opacity: 0;
}

.pin.up .halo {
  animation: ping 4.2s ease-out infinite;
}

.pin.degraded .halo {
  animation: ping 4.2s ease-out infinite;
  animation-delay: 1.2s;
}

.pin:hover .dot,
.pin:focus-visible .dot,
.pin.active .dot {
  transform: scale(1.55);
}

.pin:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 0;
}

/* 悬停标签 */
.tip {
  position: absolute;
  z-index: 3;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding: 0.34rem 0.5rem 0.38rem;
  border: 1px solid var(--line-strong);
  border-radius: 3px;
  background: var(--surface);
  box-shadow: var(--card-shadow);
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity 140ms ease;
}

.pin:hover .tip,
.pin:focus-visible .tip,
.pin.active .tip {
  opacity: 1;
}

.tip.center.above {
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
}

.tip.center.below {
  top: 24px;
  left: 50%;
  transform: translateX(-50%);
}

.tip.left.above,
.tip.left.below {
  left: -6px;
}

.tip.right.above,
.tip.right.below {
  right: -6px;
}

.tip-name {
  font-family: var(--font-display);
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--ink);
  letter-spacing: 0.01em;
}

.tip-meta {
  font-family: var(--font-mono);
  font-size: 0.68rem;
  letter-spacing: 0.06em;
  color: var(--dim);
  font-variant-numeric: tabular-nums;
}

/* 图例与脚注 */
.legend {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  margin: 0;
  padding: 0;
  list-style: none;
  font-family: var(--font-mono);
  font-size: 0.62rem;
  letter-spacing: 0.06em;
  color: var(--dim);
}

.legend li {
  display: inline-flex;
  align-items: center;
  gap: 0.28rem;
  white-space: nowrap;
}

.legend-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--unknown);
}

.legend li.up .legend-dot {
  background: var(--ok);
}
.legend li.degraded .legend-dot {
  background: var(--warn);
}
.legend li.down .legend-dot {
  background: var(--bad);
}

.legend-count {
  color: var(--faint);
  font-variant-numeric: tabular-nums;
}

.map-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.45rem 1rem;
  flex-wrap: wrap;
  padding-top: 0.2rem;
}

.hint {
  font-family: var(--font-mono);
  font-size: 0.66rem;
  letter-spacing: 0.06em;
  color: var(--dim);
}

/* 没有固定区域的节点（例如只做跳转的 root）：放到脚注，不硬塞到地图上 */
.unplaced {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
  margin: 0;
}

.unplaced-label {
  font-family: var(--font-mono);
  font-size: 0.62rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--faint);
}

.unplaced-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  min-height: 26px;
  padding: 0.1rem 0.5rem;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  background: var(--surface);
  color: var(--ink);
  font-family: var(--font-mono);
  font-size: 0.66rem;
  cursor: pointer;
}

.unplaced-chip:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.chip-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--unknown);
}

.unplaced-chip.up .chip-dot {
  background: var(--ok);
}
.unplaced-chip.degraded .chip-dot {
  background: var(--warn);
}
.unplaced-chip.down .chip-dot {
  background: var(--bad);
}

@keyframes ping {
  0% {
    transform: scale(0.5);
    opacity: 0.8;
  }
  65%,
  100% {
    transform: scale(2.1);
    opacity: 0;
  }
}

/* 手机上点会挨得近：收小命中区，标签留在点上方 */
@media (max-width: 640px) {
  .pin {
    width: 30px;
    height: 30px;
  }

  .map-head {
    padding-bottom: 0.3rem;
  }

  .map-kicker {
    font-size: 0.6rem;
    letter-spacing: 0.12em;
  }

  .legend {
    font-size: 0.58rem;
    gap: 0.5rem;
  }

  .hint {
    font-size: 0.6rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .pin .halo {
    animation: none;
  }

  .glint {
    display: none;
  }

  .hub-body,
  .hub-shadow {
    animation: none;
  }
}
</style>
