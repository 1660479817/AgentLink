<script setup>
import { computed } from "vue";

import ArrowUpRight from "../icons/ArrowUpRight.vue";
import FlameIcon from "../icons/FlameIcon.vue";
import { cardState, hotCard } from "../lib/cards.js";
import { dayShift, localTime, utcOffset } from "../lib/clock.js";
import { formatWhen } from "../lib/i18n.js";

const props = defineProps({
  item: { type: Object, required: true },
  index: { type: Number, required: true },
  locale: { type: String, required: true },
  t: { type: Function, required: true },
  now: { type: Number, required: true },
  active: { type: Boolean, default: false },
});

const status = computed(() => props.item.health.status);
const at = computed(() => new Date(props.now));

const time = computed(() => localTime(props.item.timezone, props.locale, at.value));
const offset = computed(() => utcOffset(props.item.timezone, at.value));
const shift = computed(() => dayShift(props.item.timezone, at.value));
const region = computed(() =>
  props.item.groups.length ? props.t(`region.${props.item.groups[0]}`) : null
);

// 失败时 latencyMs 记的是探测耗时（常常就是 5 秒超时），不是响应时间，不展示。
const latency = computed(() => {
  if (status.value !== "up" && status.value !== "degraded") return null;
  const value = props.item.health.latencyMs;
  return typeof value === "number" ? `${value} ms` : null;
});

const lastOk = computed(() => {
  if (status.value !== "down" || !props.item.health.lastOkAt) return null;
  const when = formatWhen(props.item.health.lastOkAt, props.locale, {
    now: at.value,
    timeZone: props.item.timezone,
    style: "narrow",
  });
  return when ? props.t("instance.lastOk", { when }) : null;
});

const never = computed(() => status.value === "unknown" && !props.item.health.lastOkAt);
const detail = computed(() => latency.value || lastOk.value || (never.value ? props.t("instance.never") : null));

const checked = computed(() => {
  const value = props.item.health.checkedAt;
  if (!value) return null;
  const when = formatWhen(value, props.locale, { now: at.value, style: "narrow" });
  return when ? props.t("instance.checked", { when }) : null;
});

const clockTitle = computed(() => {
  const parts = [];
  if (time.value) parts.push(offset.value ? `${time.value} ${offset.value}` : time.value);
  if (shift.value === 1) parts.push(props.t("instance.tomorrow"));
  if (shift.value === -1) parts.push(props.t("instance.yesterday"));
  return parts.join(" · ");
});

const bars = computed(() => ({ up: 4, degraded: 3, down: 1, unknown: 0 })[status.value] ?? 0);

// 橱窗取第一条没过期的。卡片语言由伙伴决定，页面不翻译正文。
const hot = computed(() => hotCard(props.item.cards, props.now));
const hotState = computed(() => (hot.value ? cardState(hot.value.updatedAt, props.now) : null));
const hotWhen = computed(() => {
  if (!hot.value?.updatedAt) return null;
  return formatWhen(hot.value.updatedAt, props.locale, { now: at.value, style: "narrow" });
});
const hotMore = computed(() => {
  if (!hot.value) return 0;
  return props.item.cards.filter((card) => cardState(card.updatedAt, props.now) !== "stale").length - 1;
});
</script>

<template>
  <article
    class="card"
    :id="`node-${item.id}`"
    :class="{ 'is-active': active, 'has-hot': Boolean(hot) }"
    :data-status="status"
    :style="{ '--d': `${Math.min(index, 12) * 25}ms` }"
  >
    <header class="head">
      <span class="bars" aria-hidden="true">
        <i v-for="bar in 4" :key="bar" :class="{ on: bar <= bars }" />
      </span>

      <h3 class="name-line">
        <!-- 整张卡片都是入口：名称上的伪元素铺满卡片，橱窗链接浮在它上面。 -->
        <a class="name" :href="item.url" rel="noopener noreferrer">{{ item.name }}</a>
      </h3>

      <span class="tier">{{ t(`tier.${item.tier}`) }}</span>
      <ArrowUpRight class="arrow" aria-hidden="true" />
    </header>

    <p class="intro">{{ item.intro }}</p>

    <a
      v-if="hot"
      class="hot"
      :class="hotState"
      :href="hot.url"
      rel="noopener noreferrer"
    >
      <span class="hot-tag">
        <FlameIcon class="hot-icon" aria-hidden="true" />
        {{ t("hot.label") }}
      </span>
      <span class="hot-title" :lang="hot.lang || undefined">{{ hot.title }}</span>
      <span class="hot-meta">
        <span v-if="hotWhen">{{ t("hot.updated", { when: hotWhen }) }}</span>
        <span v-else>{{ t("hot.undated") }}</span>
        <span v-if="hot.lang" class="hot-lang">{{ hot.lang.toUpperCase() }}</span>
        <span v-if="hotMore > 0">{{ t("hot.more", { count: hotMore }) }}</span>
      </span>
    </a>

    <footer class="foot">
      <span class="clock" :title="clockTitle">
        <span class="clock-time">{{ time || "—" }}</span>
        <span class="clock-meta">
          {{ region || t("region.other") }}<template v-if="offset"> · {{ offset }}</template>
        </span>
      </span>

      <span class="state" :title="checked || undefined">
        <span class="state-text">{{ t(`status.${status}`) }}</span>
        <span v-if="detail" class="state-detail">{{ detail }}</span>
      </span>
    </footer>
  </article>
</template>

<style scoped>
.card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  min-width: 0;
  padding: 0.8rem 0.9rem 0.7rem;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface);
  scroll-margin-top: 150px;
  animation: card-in 420ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  animation-delay: var(--d, 0ms);
  transition:
    border-color 160ms ease,
    box-shadow 160ms ease,
    transform 160ms ease,
    background 160ms ease;
}

/* 顶部一条状态色，与目录行原来的左侧色条同义，悬停或定位时出现。 */
.card::before {
  content: "";
  position: absolute;
  inset: -1px -1px auto;
  height: 2px;
  border-radius: 10px 10px 0 0;
  background: var(--status-color, var(--accent));
  opacity: 0;
  transition: opacity 160ms ease;
}

.card:hover,
.card:focus-within {
  border-color: var(--line-strong);
  box-shadow: var(--card-shadow);
  transform: translateY(-2px);
}

.card:hover::before,
.card:focus-within::before,
.card.is-active::before {
  opacity: 1;
}

.card.is-active {
  border-color: var(--accent);
  background: var(--row-active);
}

.card[data-status="up"] {
  --status-color: var(--ok);
}
.card[data-status="degraded"] {
  --status-color: var(--warn);
}
.card[data-status="down"] {
  --status-color: var(--bad);
}
.card[data-status="unknown"] {
  --status-color: var(--unknown);
}

/* ---------- 头部 ---------- */
.head {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
}

.bars {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: flex-end;
  gap: 2px;
  height: 13px;
}

.bars i {
  width: 2px;
  border-radius: 1px;
  background: var(--bars-off);
}

.bars i:nth-child(1) {
  height: 4px;
}
.bars i:nth-child(2) {
  height: 6px;
}
.bars i:nth-child(3) {
  height: 9px;
}
.bars i:nth-child(4) {
  height: 13px;
}

.bars i.on {
  background: var(--status-color, var(--muted));
}

.name-line {
  flex: 1;
  min-width: 0;
  font: inherit;
}

.name {
  display: block;
  overflow: hidden;
  color: var(--ink);
  font-family: var(--font-display);
  font-size: 1rem;
  font-weight: 600;
  line-height: 1.3;
  letter-spacing: -0.005em;
  text-decoration: none;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 150ms ease;
}

/* 铺满整张卡片的点击层，让卡片任意处都能进站。 */
.name::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: 10px;
}

.card:hover .name,
.card:focus-within .name {
  color: var(--accent);
}

.tier {
  flex: 0 0 auto;
  padding: 0.04rem 0.3rem;
  border: 1px solid var(--tier-line);
  border-radius: 2px;
  color: var(--tier-ink);
  font-family: var(--font-mono);
  font-size: 0.56rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.arrow {
  flex: 0 0 auto;
  width: 12px;
  height: 12px;
  color: var(--faint);
  transition:
    color 150ms ease,
    transform 150ms ease;
}

.card:hover .arrow {
  color: var(--accent);
  transform: translate(1px, -1px);
}

/* ---------- 简介 ---------- */
.intro {
  display: -webkit-box;
  min-height: 2.5em;
  overflow: hidden;
  color: var(--muted);
  font-size: 0.78rem;
  line-height: 1.45;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

/* ---------- 橱窗 ---------- */
.hot {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: 0.1rem 0.45rem;
  min-height: 44px;
  padding: 0.4rem 0.5rem 0.4rem 0.55rem;
  border: 1px solid var(--hot-line);
  border-left: 2px solid var(--hot-ink);
  border-radius: 6px;
  background: var(--hot-bg);
  text-decoration: none;
  transition:
    border-color 160ms ease,
    background 160ms ease;
}

.hot:hover,
.hot:focus-visible {
  border-color: var(--hot-ink);
  background: var(--hot-bg-strong);
}

.hot-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.22rem;
  padding-top: 0.06rem;
  color: var(--hot-ink);
  font-family: var(--font-mono);
  font-size: 0.55rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  white-space: nowrap;
}

.hot-icon {
  width: 11px;
  height: 11px;
}

.hot-title {
  display: -webkit-box;
  overflow: hidden;
  color: var(--ink);
  font-size: 0.78rem;
  font-weight: 500;
  line-height: 1.35;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.hot-meta {
  grid-column: 2;
  display: flex;
  align-items: baseline;
  gap: 0.35rem;
  flex-wrap: wrap;
  color: var(--dim);
  font-family: var(--font-mono);
  font-size: 0.58rem;
  letter-spacing: 0.02em;
}

.hot-lang {
  padding: 0 0.2rem;
  border: 1px solid var(--line);
  border-radius: 2px;
  color: var(--faint);
  font-size: 0.54rem;
  letter-spacing: 0.08em;
}

/* 超过一周的橱窗转灰：还在，但不再当“新闻”读。 */
.hot.aging {
  border-left-color: var(--line-strong);
  background: var(--surface-soft);
}

.hot.aging .hot-tag,
.hot.aging .hot-icon {
  color: var(--faint);
}

.hot.aging .hot-title {
  color: var(--muted);
}

/* ---------- 页脚 ---------- */
.foot {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 0.5rem;
  margin-top: auto;
  padding-top: 0.3rem;
  border-top: 1px solid var(--line);
}

.clock {
  display: flex;
  align-items: baseline;
  gap: 0.35rem;
  min-width: 0;
  font-family: var(--font-mono);
  white-space: nowrap;
}

.clock-time {
  color: var(--ink);
  font-size: 0.76rem;
  font-variant-numeric: tabular-nums;
}

.clock-meta {
  overflow: hidden;
  color: var(--dim);
  font-size: 0.6rem;
  letter-spacing: 0.04em;
  text-overflow: ellipsis;
}

.state {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.02rem;
  min-width: 0;
  font-family: var(--font-mono);
  text-align: right;
}

.state-text {
  color: var(--status-color, var(--muted));
  font-size: 0.64rem;
  letter-spacing: 0.04em;
}

.state-detail {
  color: var(--dim);
  font-size: 0.6rem;
  font-variant-numeric: tabular-nums;
}

@keyframes card-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

/* 卡片很窄时（单列长文案），页脚退回上下两行，状态贴右。 */
@container (max-width: 250px) {
  .clock-meta {
    display: none;
  }
}

@media (max-width: 640px) {
  .card {
    padding: 0.85rem 0.9rem 0.75rem;
  }

  .name {
    font-size: 1.02rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .card {
    animation: none;
  }
}
</style>
