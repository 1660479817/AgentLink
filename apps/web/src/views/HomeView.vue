<script setup>
import { computed } from "vue";
import {
  AgentIcon,
  CpuIcon,
  ExchangeIcon,
  SearchIcon,
  StackIcon,
  UploadIcon,
  UserIcon,
} from "../icons/index.js";
import { formatInteger } from "../lib/format.js";
import { t } from "../i18n/index.js";
import { useInfoBufferStore } from "../stores/infoBuffer";

const webCaps = [
  { icon: SearchIcon, key: "home.roleWeb1" },
  { icon: ExchangeIcon, key: "home.roleWeb2" },
  { icon: StackIcon, key: "home.roleWeb3" },
];
const agentCaps = [
  { icon: UploadIcon, key: "home.roleAgent1" },
  { icon: AgentIcon, key: "home.roleAgent2" },
  { icon: CpuIcon, key: "home.roleAgent3" },
];

const buffer = useInfoBufferStore();
const home = computed(() => buffer.surfaces.home);
const mine = computed(() => buffer.surfaces.mine);
const status = computed(() => buffer.status);
const viewer = computed(() => buffer.viewer);

const displayName = computed(
  () => viewer.value?.displayName || viewer.value?.email?.split("@")[0] || ""
);
</script>

<template>
  <div v-if="viewer" class="card welcome-strip">
    <p class="chip">{{ t("home.tagline") }}</p>
    <h2 style="margin: 0.5rem 0">{{ t("home.welcomeBack", { name: displayName }) }}</h2>
    <p class="muted">
      {{ mine?.welcome?.agentTokenActive ? t("mine.agentConfigured") : t("mine.agentNotConfigured") }}
      ·
      <RouterLink :to="{ name: 'mine-settings' }">{{ t("home.quickAgent") }}</RouterLink>
      <template v-if="mine?.welcome?.ingestProcessingCount > 0">
        ·
        <RouterLink :to="{ name: 'mine-publish' }">
          {{ t("home.ingestProcessingLink", { count: mine.welcome.ingestProcessingCount }) }}
        </RouterLink>
      </template>
    </p>
    <div class="quick-actions hero-actions">
      <RouterLink to="/plaza" class="button-link secondary">{{ t("home.quickPlaza") }}</RouterLink>
      <RouterLink :to="{ name: 'mine-publish' }" class="button-link secondary">{{
        t("home.quickProvide")
      }}</RouterLink>
      <RouterLink :to="{ name: 'mine-cards' }" class="button-link secondary">{{
        t("home.quickCards")
      }}</RouterLink>
    </div>
  </div>
  <div v-else class="card hero-panel">
    <p class="chip">{{ t("home.tagline") }}</p>
    <h1>{{ t("home.headline") }}</h1>
    <p class="muted">{{ t("home.subhead") }}</p>
    <div class="hero-actions">
      <RouterLink to="/plaza" class="button-link">{{ t("home.ctaPlaza") }}</RouterLink>
      <RouterLink to="/login" class="button-link secondary">{{ t("home.ctaLogin") }}</RouterLink>
    </div>
  </div>

  <div class="card">
    <p class="section-head">{{ t("home.overviewTitle") }}</p>
    <p v-if="status === 'loading' && !home?.stats" class="muted">{{ t("home.syncing") }}</p>
    <div v-else-if="home?.stats" class="stat-grid">
      <div class="stat-pill">
        <div class="stat-value">{{ formatInteger(home.stats.cardsTotal) }}</div>
        <div class="muted stat-label">{{ t("home.statsCardsTotal") }}</div>
      </div>
      <div class="stat-pill">
        <div class="stat-value">{{ formatInteger(home.stats.cardsNewToday) }}</div>
        <div class="muted stat-label">{{ t("home.statsCardsNewToday") }}</div>
      </div>
      <div class="stat-pill">
        <div class="stat-value">{{ formatInteger(home.stats.exchangesToday) }}</div>
        <div class="muted stat-label">{{ t("home.statsExchangesToday") }}</div>
      </div>
      <div class="stat-pill">
        <div class="stat-value">{{ formatInteger(home.stats.ingestSessionsDoneTotal) }}</div>
        <div class="muted stat-label">{{ t("home.statsIngestDoneTotal") }}</div>
      </div>
      <div class="stat-pill">
        <div class="stat-value">{{ formatInteger(home.stats.ingestSessionsDoneToday) }}</div>
        <div class="muted stat-label">{{ t("home.statsIngestDoneToday") }}</div>
      </div>
    </div>
    <p v-else class="muted">{{ t("home.noStats") }}</p>
    <p v-if="home?.stats?.statsTimezone" class="muted" style="margin-bottom: 0; font-size: 0.8rem">
      {{ t("home.statsTimezoneHint", { tz: home.stats.statsTimezone }) }}
    </p>
  </div>

  <div class="card">
    <p class="section-head">{{ t("home.rolesTitle") }}</p>
    <div class="role-bento">
      <section class="role-panel role-panel--web" :aria-label="t('home.roleWebTitle')">
        <header class="role-panel-head">
          <span class="role-panel-icon" aria-hidden="true">
            <UserIcon />
          </span>
          <div>
            <p class="chip role-panel-badge">{{ t("home.roleWebBadge") }}</p>
            <h3 class="role-panel-title">{{ t("home.roleWebTitle") }}</h3>
          </div>
        </header>
        <ul class="cap-grid">
          <li v-for="(item, i) in webCaps" :key="item.key" class="cap-cell">
            <span class="cap-icon" aria-hidden="true">
              <component :is="item.icon" />
            </span>
            <span class="cap-label">
              <span class="cap-index">{{ String(i + 1).padStart(2, "0") }}</span>
              {{ t(item.key) }}
            </span>
          </li>
        </ul>
      </section>
      <div class="role-bridge" aria-hidden="true">
        <span class="role-bridge-line" />
        <span class="role-bridge-node">{{ t("home.roleBridge") }}</span>
        <span class="role-bridge-line" />
      </div>
      <section class="role-panel role-panel--agent" :aria-label="t('home.roleAgentTitle')">
        <header class="role-panel-head">
          <span class="role-panel-icon role-panel-icon--agent" aria-hidden="true">
            <AgentIcon />
          </span>
          <div>
            <p class="chip role-panel-badge role-panel-badge--agent">{{ t("home.roleAgentBadge") }}</p>
            <h3 class="role-panel-title">{{ t("home.roleAgentTitle") }}</h3>
          </div>
        </header>
        <ul class="cap-grid">
          <li v-for="(item, i) in agentCaps" :key="item.key" class="cap-cell">
            <span class="cap-icon cap-icon--agent" aria-hidden="true">
              <component :is="item.icon" />
            </span>
            <span class="cap-label">
              <span class="cap-index">{{ String(i + 1).padStart(2, "0") }}</span>
              {{ t(item.key) }}
            </span>
          </li>
        </ul>
      </section>
    </div>
  </div>

  <div class="card">
    <p class="section-head">{{ t("home.stepsTitle") }}</p>
    <ol class="steps-list">
      <li>{{ t("home.step1") }}</li>
      <li>{{ t("home.step2") }}</li>
      <li>{{ t("home.step3") }}</li>
    </ol>
  </div>

  <div v-if="home?.previewCards?.length" class="card">
    <p class="section-head">{{ t("home.previewTitle") }}</p>
    <div class="grid-cards">
      <article v-for="c in home.previewCards" :key="c.id" class="card info-card">
        <div v-if="c.thumbUrl" class="media-frame" style="margin-bottom: 0.65rem">
          <img :src="c.thumbUrl" alt="" width="320" height="180" loading="lazy" />
        </div>
        <h4>
          <RouterLink :to="{ name: 'card', params: { id: c.id } }">{{ c.title }}</RouterLink>
        </h4>
        <p class="card-summary">{{ c.summary || "" }}</p>
        <RouterLink :to="{ name: 'card', params: { id: c.id } }">{{ t("card.detail") }}</RouterLink>
        ·
        <RouterLink to="/plaza">{{ t("home.previewLink") }}</RouterLink>
      </article>
    </div>
  </div>
</template>
