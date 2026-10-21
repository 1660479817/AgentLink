<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";

import BrandMark from "./components/BrandMark.vue";
import GlobePattern from "./components/GlobePattern.vue";
import JoinPanel from "./components/JoinPanel.vue";
import LangSwitch from "./components/LangSwitch.vue";
import NetworkMap from "./components/NetworkMap.vue";
import NodeCard from "./components/NodeCard.vue";
import FlameIcon from "./icons/FlameIcon.vue";
import MoonIcon from "./icons/MoonIcon.vue";
import SunIcon from "./icons/SunIcon.vue";
import { cardState } from "./lib/cards.js";
import { localTime } from "./lib/clock.js";
import { formatWhen } from "./lib/i18n.js";
import { availableGroups, availableTags, buildView, filterByGroup, filterByTag, summarize } from "./lib/hub.js";

const props = defineProps({
  locale: { type: String, required: true },
  t: { type: Function, required: true },
});

const data = ref(null);
const error = ref(false);
const loading = ref(true);
const group = ref("all");
const tag = ref("");
const onlineOnly = ref(false);
const hotOnly = ref(false);
const highlight = ref(null);

const theme = ref(document.documentElement.dataset.theme === "dark" ? "dark" : "light");

// 目录里的钟点每 20 秒走一次；本地时间只到分钟，不必更勤。
const now = ref(Date.now());
let ticker = null;
let flashTimer = null;

const view = computed(() => (data.value ? buildView(data.value) : []));
const groups = computed(() => availableGroups(view.value));
const tags = computed(() => availableTags(view.value));
const filtered = computed(() => filterByTag(filterByGroup(view.value, group.value), tag.value));

// 有橱窗的实例：卡片里会多一块热点，筛选条也据此出现「只看热点」。
// 超过 30 天的橱窗不再算热点，与卡片里的判断同一口径。
const hasHot = (item) =>
  Array.isArray(item.cards) && item.cards.some((card) => cardState(card.updatedAt, now.value) !== "stale");
const hotCount = computed(() => filtered.value.filter(hasHot).length);

const visible = computed(() => {
  let rows = filtered.value;
  if (onlineOnly.value) {
    rows = rows.filter(
      (item) => item.health.status === "up" || item.health.status === "degraded"
    );
  }
  if (hotOnly.value) rows = rows.filter(hasHot);
  return rows;
});
const summary = computed(() => summarize(view.value, data.value?.generatedAt ?? null));

// 在线 = 探得通（up 与 degraded 都算），与地图、顶栏用同一个口径。
const online = computed(() => summary.value.reachable);

// “最近同步”用探测时间。生成时间每次请求都会变，用它会把旧数据说成刚刚同步。
const syncedAt = computed(() => data.value?.checkedAt ?? data.value?.generatedAt ?? null);
const syncWhen = computed(() =>
  syncedAt.value ? formatWhen(syncedAt.value, props.locale) || "—" : "—"
);

const chips = computed(() => [
  { key: "all", label: props.t("filter.all"), count: view.value.length },
  ...groups.value.map((key) => ({
    key,
    label: props.t(`region.${key}`),
    count: view.value.filter((item) => item.groups.includes(key)).length,
  })),
]);

// 自由文本标签：值原样上屏，不翻译；只在真有站点用标签时出现。
const tagChips = computed(() => [
  { key: "", label: props.t("filter.all"), count: view.value.length },
  ...tags.value.map((value) => ({
    key: value,
    label: value,
    count: view.value.filter((item) => item.tags.includes(value)).length,
  })),
]);

// 地图上的点与目录用同一份数据；被筛掉的点变暗但仍可点。
const mapItems = computed(() =>
  view.value.map((item) => ({
    id: item.id,
    name: item.name,
    status: item.health.status,
    regions: item.region ? [item.region] : [],
    groupLabel: item.groups.length ? props.t(`region.${item.groups[0]}`) : props.t("region.other"),
    localTime: localTime(item.timezone, props.locale, new Date(now.value)) || "—",
    visible: visible.value.some((row) => row.id === item.id),
  }))
);

const themeLabel = computed(() =>
  theme.value === "dark" ? props.t("portal.toLight") : props.t("portal.toDark")
);

function toggleTheme() {
  const next = theme.value === "dark" ? "light" : "dark";
  theme.value = next;
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("xknot-theme", next);
  } catch {
    // 隐私模式下写不了存储，本次会话内仍然生效。
  }
}

// 点地图上的点：先确保它在当前筛选里，再滚到那一条并短暂高亮。
async function focusNode(id) {
  const reachable = visible.value.some((item) => item.id === id);
  if (!reachable) {
    group.value = "all";
    tag.value = "";
    onlineOnly.value = false;
    hotOnly.value = false;
    await nextTick();
  }

  highlight.value = id;
  document.getElementById(`node-${id}`)?.scrollIntoView({ block: "center", behavior: "smooth" });

  window.clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => {
    highlight.value = null;
  }, 2600);
}

async function load() {
  loading.value = true;
  error.value = false;
  try {
    const response = await fetch("/data/hub.json", { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(String(response.status));
    data.value = await response.json();
  } catch {
    error.value = true;
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  load();
  ticker = window.setInterval(() => {
    now.value = Date.now();
  }, 20000);
});

onBeforeUnmount(() => {
  window.clearInterval(ticker);
  window.clearTimeout(flashTimer);
});
</script>

<template>
  <a class="skip" href="#nodes">{{ t("portal.skipToContent") }}</a>

  <div class="split">
    <!-- 左：当前联邦的全球网络 -->
    <section class="net" aria-labelledby="net-title">
      <header class="net-top">
        <a class="brand" :href="`/${locale}/`">
          <BrandMark class="mark" :size="26" />
          <span class="brand-word">{{ t("hero.wordmark") }}</span>
          <span class="brand-sep" aria-hidden="true">/</span>
          <span class="brand-name">{{ t("hero.name") }}</span>
        </a>

        <div class="net-top-right">
          <span class="pill" :class="{ stable: summary.nodes > 0 && online === summary.nodes }">
            <span class="pulse" aria-hidden="true" />
            <span>{{ t("status.online", { ok: online, total: summary.nodes }) }}</span>
          </span>

          <div class="controls controls--mobile">
            <button
              type="button"
              class="icon-btn"
              :aria-label="themeLabel"
              :title="themeLabel"
              @click="toggleTheme"
            >
              <SunIcon v-if="theme === 'dark'" />
              <MoonIcon v-else />
            </button>
            <LangSwitch :locale="locale" :t="t" />
          </div>
        </div>
      </header>

      <div class="net-scroll">
        <div class="net-inner">
          <section class="mast">
            <div class="mast-copy">
              <p class="eyebrow">
                <span class="eyebrow-dot" aria-hidden="true" />
                {{ t("hero.eyebrow") }}
                <span class="eyebrow-sep" aria-hidden="true">/</span>
                <span class="eyebrow-muted">{{ t("hero.protocol") }}</span>
              </p>

              <h1 id="net-title">
                <span class="wordmark">{{ t("hero.wordmark") }}</span>
                <span class="name-outline">{{ t("hero.name") }}</span>
              </h1>

              <p class="lede">{{ t("portal.tagline") }}</p>
              <p class="mast-note">{{ t("hero.summary") }}</p>

              <a class="mast-join" href="#join">{{ t("join.jump") }}</a>
            </div>
          </section>

          <div class="board">
            <NetworkMap :items="mapItems" :active-id="highlight" :t="t" @select="focusNode" />
          </div>

          <dl class="stats">
            <div class="stat">
              <dt>{{ t("stats.nodes") }}</dt>
              <dd>{{ summary.nodes }}</dd>
            </div>
            <div class="stat">
              <dt>{{ t("stats.regions") }}</dt>
              <dd>{{ summary.regions }}</dd>
            </div>
            <div class="stat">
              <dt>{{ t("stats.online") }}</dt>
              <dd class="stat-ok">{{ online }}</dd>
            </div>
            <div class="stat stat-wide">
              <dt>{{ t("stats.sync") }}</dt>
              <dd class="stat-time">{{ syncWhen }}</dd>
            </div>
          </dl>

          <section id="nodes" class="directory" aria-labelledby="directory-title">
            <div class="dir-bar">
              <div class="dir-head">
                <h2 id="directory-title" class="dir-title">
                  {{ t("nodes.label") }}
                  <span class="dir-count" aria-live="polite">
                    {{ t("instance.listed", { count: visible.length }) }}
                  </span>
                </h2>

                <div class="dir-controls">
                  <button
                    v-if="hotCount || hotOnly"
                    type="button"
                    class="switch hot-switch"
                    role="switch"
                    :aria-checked="hotOnly"
                    @click="hotOnly = !hotOnly"
                  >
                    <FlameIcon class="flame" aria-hidden="true" />
                    {{ t("nodes.hotOnly") }}
                    <span class="switch-count">{{ hotCount }}</span>
                  </button>

                  <button
                    type="button"
                    class="switch"
                    role="switch"
                    :aria-checked="onlineOnly"
                    @click="onlineOnly = !onlineOnly"
                  >
                    <span class="switch-track" aria-hidden="true"><span class="switch-knob" /></span>
                    {{ t("nodes.onlineOnly") }}
                  </button>
                </div>
              </div>

              <div class="chips" role="group" :aria-label="t('filter.label')">
                <button
                  v-for="chip in chips"
                  :key="chip.key"
                  type="button"
                  class="chip"
                  :class="{ active: group === chip.key }"
                  :aria-pressed="group === chip.key"
                  @click="group = chip.key"
                >
                  <span>{{ chip.label }}</span>
                  <span class="chip-count">{{ chip.count }}</span>
                </button>
              </div>

              <div v-if="tagChips.length > 1" class="chips" role="group" :aria-label="t('tag.label')">
                <button
                  v-for="chip in tagChips"
                  :key="chip.key || 'all'"
                  type="button"
                  class="chip"
                  :class="{ active: tag === chip.key }"
                  :aria-pressed="tag === chip.key"
                  @click="tag = chip.key"
                >
                  <span>{{ chip.label }}</span>
                  <span class="chip-count">{{ chip.count }}</span>
                </button>
              </div>
            </div>

            <div v-if="loading" class="skeleton-list" aria-live="polite">
              <p class="sr-only">{{ t("state.loading") }}</p>
              <div v-for="n in 4" :key="n" class="skeleton" aria-hidden="true">
                <span class="sk-line sk-title" />
                <span class="sk-line sk-short" />
                <span class="sk-line sk-mid" />
                <span class="sk-line sk-tall" />
              </div>
            </div>

            <div v-else-if="error" class="notice" role="alert">
              <p>{{ t("state.error") }}</p>
              <button type="button" class="retry" @click="load">{{ t("state.retry") }}</button>
            </div>

            <div v-else-if="!visible.length" class="notice">
              <p>{{ view.length ? t("instance.emptyFiltered") : t("instance.empty") }}</p>
            </div>

            <div v-else class="cards">
              <NodeCard
                v-for="(item, index) in visible"
                :key="item.id"
                :item="item"
                :index="index"
                :locale="locale"
                :t="t"
                :now="now"
                :active="highlight === item.id"
              />
            </div>
          </section>

          <footer class="net-foot">
            <p class="foot-copy">{{ t("footer.disclaimer") }}</p>
            <div class="foot-meta">
              <span class="foot-code">XKNOT.SI</span>
              <span aria-hidden="true">·</span>
              <span>{{ t("hero.protocol") }}</span>
              <span aria-hidden="true">·</span>
              <span>{{ t("footer.license") }}</span>
              <a class="admin-link" href="/admin/">{{ t("footer.admin") }}</a>
            </div>
          </footer>
        </div>
      </div>
    </section>

    <!-- 右：申请加入 -->
    <aside id="join" class="join-pane">
      <GlobePattern />

      <header class="join-top">
        <p class="join-brand">XKNOT<span>·SI</span></p>
        <div class="controls controls--desktop">
          <button
            type="button"
            class="icon-btn on-accent"
            :aria-label="themeLabel"
            :title="themeLabel"
            @click="toggleTheme"
          >
            <SunIcon v-if="theme === 'dark'" />
            <MoonIcon v-else />
          </button>
          <LangSwitch :locale="locale" :t="t" variant="accent" />
        </div>
      </header>

      <div class="join-scroll">
        <JoinPanel :locale="locale" :t="t" />
      </div>
    </aside>
  </div>
</template>

<style scoped>
.skip {
  position: absolute;
  left: -9999px;
  top: 0;
  z-index: 50;
  padding: 0.7rem 1rem;
  background: var(--accent);
  color: #ffffff;
  font-family: var(--font-mono);
  font-size: 0.75rem;
}

.skip:focus {
  left: 0.75rem;
  top: 0.75rem;
}

/* 一屏两栏：左白右橙，各自滚动 */
.split {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr);
  grid-template-rows: minmax(0, 1fr);
  height: 100dvh;
  min-height: 600px;
}

/* ---------- 左栏 ---------- */
.net {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--surface);
  border-right: 1px solid var(--line);
}

.net::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(to right, var(--grid-line) 1px, transparent 1px),
    linear-gradient(to bottom, var(--grid-line) 1px, transparent 1px);
  background-size: 76px 76px;
  mask-image: radial-gradient(ellipse 90% 55% at 22% -6%, #000 10%, transparent 72%);
  opacity: 0.9;
}

.net-top {
  position: relative;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.8rem;
  flex-wrap: wrap;
  padding: 0.95rem clamp(1.1rem, 2.6vw, 2.4rem);
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--ink);
  text-decoration: none;
}

.mark {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
}

.brand-word {
  font-family: var(--font-mono);
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.24em;
}

.brand-sep {
  color: var(--line-strong);
}

.brand-name {
  font-size: 0.8rem;
  letter-spacing: 0.08em;
  color: var(--muted);
}

.net-top-right {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.26rem 0.58rem;
  border: 1px solid rgba(161, 98, 7, 0.28);
  border-radius: 999px;
  background: rgba(161, 98, 7, 0.08);
  color: var(--warn);
  font-family: var(--font-mono);
  font-size: 0.62rem;
  letter-spacing: 0.1em;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.pill.stable {
  border-color: rgba(11, 122, 84, 0.26);
  background: rgba(11, 122, 84, 0.07);
  color: var(--ok);
}

.pulse {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  animation: blink 2.4s ease-in-out infinite;
}

.controls {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}

.controls--mobile {
  display: none;
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 2px;
  background: var(--surface);
  color: var(--muted);
  font-size: 1rem;
  cursor: pointer;
  transition:
    color 160ms ease,
    border-color 160ms ease,
    background 160ms ease;
}

.icon-btn:hover {
  color: var(--accent);
  border-color: var(--line-strong);
  background: var(--surface-soft);
}

.icon-btn.on-accent {
  border-color: rgba(255, 255, 255, 0.42);
  background: rgba(255, 255, 255, 0.12);
  color: #ffffff;
}

.icon-btn.on-accent:hover {
  border-color: rgba(255, 255, 255, 0.8);
  background: rgba(255, 255, 255, 0.22);
}

.net-scroll {
  position: relative;
  z-index: 1;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: clip;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: var(--line-strong) transparent;
}

.net-inner {
  --pad: clamp(1.1rem, 2.6vw, 2.4rem);
  padding: 0 var(--pad);
}

/* 刊头 */
.mast {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
  padding-block: clamp(1rem, 2.6vh, 2rem) 0.4rem;
}

.mast-copy {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  width: 100%;
  min-width: 0;
}

.eyebrow {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  font-family: var(--font-mono);
  font-size: 0.62rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--accent);
}

.eyebrow-dot {
  width: 4px;
  height: 4px;
  background: var(--accent);
}

.eyebrow-sep,
.eyebrow-muted {
  color: var(--faint);
}

h1 {
  display: flex;
  align-items: baseline;
  gap: 0.55rem;
  margin: 0;
  flex-wrap: wrap;
}

.wordmark {
  font-family: var(--font-display);
  font-size: clamp(2.2rem, 1.5rem + 1.9vw, 3.1rem);
  font-weight: 700;
  line-height: 0.95;
  letter-spacing: 0.02em;
  background: linear-gradient(96deg, var(--wordmark-1) 12%, var(--wordmark-2) 58%, var(--wordmark-3) 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.name-outline {
  font-family: var(--font-display);
  font-size: clamp(1.15rem, 0.9rem + 0.8vw, 1.45rem);
  font-weight: 500;
  letter-spacing: 0.1em;
  color: transparent;
  -webkit-text-stroke: 1px var(--outline-ink);
  /* 描边字太细会发虚：衬一层与底同色的实心，只留 1px 边。 */
  text-shadow: 0 0 0.5px var(--outline-ink);
}

.lede {
  max-width: 46ch;
  color: var(--ink);
  font-size: clamp(0.95rem, 0.9rem + 0.2vw, 1.05rem);
  line-height: 1.5;
}

.mast-note {
  max-width: 58ch;
  color: var(--dim);
  font-size: 0.78rem;
  line-height: 1.6;
}

/* 窄屏申请表排在实例目录之后，这里给一个直达入口。 */
.mast-join {
  display: none;
  align-self: flex-start;
  min-height: 40px;
  padding: 0.55rem 0.95rem;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  color: var(--ink);
  font-family: var(--font-mono);
  font-size: 0.74rem;
  text-decoration: none;
}

.mast-join:hover {
  border-color: var(--accent);
  color: var(--accent);
}

/* 联邦地图：整幅铺开，是左栏的主图，不再缩在刊头右侧 */
.board {
  margin-top: 0.6rem;
}

/* 统计 */
.stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, auto));
  justify-content: start;
  gap: 1.2rem;
  margin: 0.9rem 0 0;
  padding: 0.85rem 0 0.9rem;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}

.stat dt {
  font-family: var(--font-mono);
  font-size: 0.62rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--muted);
  white-space: nowrap;
}

.stat dd {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1.3rem;
  font-weight: 600;
  line-height: 1;
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}

.stat dd.stat-ok {
  color: var(--ok);
}

.stat dd.stat-time {
  padding-top: 0.25rem;
  font-family: var(--font-mono);
  font-size: 0.72rem;
  font-weight: 400;
  letter-spacing: 0.02em;
  color: var(--muted);
  white-space: nowrap;
}

/* 目录 */
.directory {
  padding-bottom: 1.2rem;
}

.dir-bar {
  position: sticky;
  top: 0;
  z-index: 4;
  margin-inline: calc(var(--pad) * -1);
  padding: 0.55rem var(--pad) 0.35rem;
  background: var(--surface);
  border-bottom: 1px solid var(--line);
}

.dir-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.8rem;
  flex-wrap: wrap;
}

.dir-title {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  font-family: var(--font-mono);
  font-size: 0.66rem;
  font-weight: 500;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--ink);
}

.dir-count {
  font-size: 0.6rem;
  letter-spacing: 0.08em;
  color: var(--dim);
  text-transform: none;
  white-space: nowrap;
}

.switch {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.2rem;
  border: 0;
  background: none;
  color: var(--dim);
  font-family: var(--font-mono);
  font-size: 0.62rem;
  letter-spacing: 0.06em;
  cursor: pointer;
  transition: color 160ms ease;
}

.switch:hover {
  color: var(--ink);
}

.switch-track {
  display: inline-flex;
  align-items: center;
  width: 28px;
  height: 16px;
  padding: 2px;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  background: var(--surface);
  transition:
    background 160ms ease,
    border-color 160ms ease;
}

.switch-knob {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--dim);
  transition:
    transform 160ms ease,
    background 160ms ease;
}

.dir-controls {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  flex-wrap: wrap;
}

/* 热点筛选只在有橱窗时出现：没有热点，就不摆一个永远点不出东西的开关。 */
.hot-switch {
  color: var(--hot-ink);
}

.hot-switch .flame {
  width: 11px;
  height: 11px;
}

.switch-count {
  padding: 0 0.28rem;
  border-radius: 999px;
  background: var(--hot-bg-strong);
  font-size: 0.56rem;
  font-variant-numeric: tabular-nums;
  line-height: 1.5;
}

.switch[aria-checked="true"] {
  color: var(--accent);
}

.hot-switch[aria-checked="true"] {
  color: #ffffff;
  padding-inline: 0.4rem;
  border-radius: 999px;
  background: var(--hot-ink);
}

.hot-switch[aria-checked="true"] .switch-count {
  background: rgba(255, 255, 255, 0.22);
  color: #ffffff;
}

.switch[aria-checked="true"] .switch-track {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.switch[aria-checked="true"] .switch-knob {
  background: var(--accent);
  transform: translateX(12px);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.28rem;
  padding-block: 0.55rem 0.45rem;
}

.chip {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 0.32rem;
  min-height: 28px;
  padding: 0.16rem 0.55rem;
  border: 1px solid transparent;
  border-radius: 999px;
  background: var(--chip-bg);
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 0.62rem;
  letter-spacing: 0.05em;
  cursor: pointer;
  transition:
    border-color 160ms ease,
    color 160ms ease,
    background 160ms ease;
}

.chip:hover {
  color: var(--ink);
  background: var(--chip-hover);
}

.chip.active {
  border-color: var(--accent);
  background: var(--accent);
  color: #ffffff;
}

.chip-count {
  font-size: 0.6rem;
  opacity: 0.75;
  font-variant-numeric: tabular-nums;
}

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(272px, 1fr));
  gap: 0.7rem;
  align-content: start;
  padding-block: 0.75rem 0.5rem;
}

/* 骨架屏沿用卡片结构，加载时不跳版 */
.skeleton-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(272px, 1fr));
  gap: 0.7rem;
  padding-block: 0.75rem 0.5rem;
}

.skeleton {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  min-height: 148px;
  padding: 0.9rem;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface);
}

.sk-line {
  height: 9px;
  border-radius: 2px;
  background: linear-gradient(90deg, var(--skeleton-a) 0%, var(--skeleton-b) 45%, var(--skeleton-a) 100%);
  background-size: 220% 100%;
  animation: shimmer 1.6s linear infinite;
}

.sk-title {
  width: 46%;
  height: 12px;
}

.sk-short {
  width: 32%;
  height: 7px;
}

.sk-mid {
  width: 82%;
}

.sk-tall {
  width: 100%;
  height: 34px;
  margin-top: auto;
}

.notice {
  margin-top: 0.9rem;
  padding: 1.4rem;
  border: 1px dashed var(--line-strong);
  border-radius: 6px;
  color: var(--muted);
  font-size: 0.88rem;
  background: var(--surface-soft);
}

.retry {
  margin-top: 0.7rem;
  min-height: 36px;
  padding: 0.32rem 0.85rem;
  border: 1px solid var(--accent);
  border-radius: 2px;
  background: var(--accent-soft);
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: 0.7rem;
  letter-spacing: 0.1em;
  cursor: pointer;
}

/* 页脚 */
.net-foot {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  margin-top: 1.4rem;
  padding: 1.1rem 0 1.6rem;
  border-top: 1px solid var(--line);
}

.foot-copy {
  max-width: 46ch;
  color: var(--dim);
  font-size: 0.74rem;
  line-height: 1.55;
}

.foot-meta {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
  font-family: var(--font-mono);
  font-size: 0.6rem;
  letter-spacing: 0.08em;
  color: var(--faint);
}

.foot-code {
  color: var(--accent);
}

.admin-link {
  color: var(--faint);
  text-decoration: none;
  border-bottom: 1px solid var(--line-strong);
}

.admin-link:hover {
  color: var(--accent);
  border-bottom-color: var(--accent);
}

/* ---------- 右栏 ---------- */
.join-pane {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  color: #ffffff;
  background:
    radial-gradient(ellipse 80% 60% at 88% 8%, rgba(255, 255, 255, 0.16), transparent 62%),
    linear-gradient(180deg, rgba(84, 26, 0, 0.08) 0%, rgba(84, 26, 0, 0.2) 100%),
    linear-gradient(158deg, var(--join-1) 0%, var(--join-2) 56%, var(--join-3) 100%);
}

.join-pane::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.055) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.055) 1px, transparent 1px);
  background-size: 54px 54px;
  mask-image: radial-gradient(ellipse 85% 70% at 62% 34%, #000 6%, transparent 78%);
}

.join-top {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.8rem;
  /* 与下面 540px 的表单列对齐；窄栏时退回普通内边距。 */
  padding: 0.8rem
    max(clamp(1.2rem, 2.8vw, 2.4rem), calc((100% - 540px) / 2));
}

.join-brand {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.24em;
  color: rgba(255, 255, 255, 0.86);
}

.join-brand span {
  margin-left: 0.2rem;
  color: rgba(255, 255, 255, 0.55);
}

.join-scroll {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 0 clamp(1.2rem, 2.8vw, 2.4rem) 1.2rem;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.35) transparent;
}

.join-scroll > :deep(.join) {
  width: 100%;
  max-width: 540px;
  margin-inline: auto;
  margin-block: auto;
  padding-block: 0.4rem 1rem;
}

@keyframes blink {
  50% {
    opacity: 0.35;
  }
}

@keyframes shimmer {
  to {
    background-position: -120% 0;
  }
}

@media (max-width: 1100px) {
  .split {
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 0.8fr);
  }

  .stats {
    gap: 0.9rem;
  }

  .stat dd {
    font-size: 1.15rem;
  }
}

/* 一屏放不下就上下排：白在上，橙在下 */
@media (max-width: 900px) {
  .split {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto;
    height: auto;
    min-height: 0;
  }

  .net {
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }

  .net-scroll {
    overflow: visible;
  }

  .net-top {
    padding-block: 0.85rem;
  }

  .controls--mobile {
    display: flex;
  }

  .controls--desktop {
    display: none;
  }

  .mast {
    padding-top: 1.1rem;
  }

  .mast-join {
    display: inline-flex;
    align-items: center;
    margin-top: 0.2rem;
  }

  .dir-bar {
    position: static;
    background: transparent;
    border-bottom: 1px solid var(--line);
  }

  .join-pane {
    min-height: 0;
    overflow: hidden;
  }

  .join-scroll {
    overflow: visible;
    padding-bottom: 2.2rem;
  }

  .join-scroll > :deep(.join) {
    padding-block: 1.4rem 0;
  }
}

@media (max-width: 640px) {
  .brand-sep,
  .brand-name {
    display: none;
  }

  .pill {
    display: none;
  }

  .stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.8rem 1rem;
  }

  .stat {
    padding-right: 0;
    border-right: 0;
  }

  .chip {
    min-height: 44px;
  }

  .switch {
    min-height: 44px;
  }

  /* 手机上 11 个胶囊换行要占三行，改回一条横滑：横向滑动是手机上的直觉。
     右缘淡出，让人看得出后面还有。 */
  .chips {
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
    mask-image: linear-gradient(to right, #000 calc(100% - 26px), transparent);
  }

  .chips::-webkit-scrollbar {
    display: none;
  }

  .net-foot {
    flex-direction: column;
    gap: 0.7rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .pulse,
  .sk-line {
    animation: none;
  }
}
</style>
