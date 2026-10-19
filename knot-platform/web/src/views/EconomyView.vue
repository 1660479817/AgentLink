<script setup>
import { computed, onMounted, ref } from "vue";
import AppButton from "../components/AppButton.vue";
import { CoinIcon, RefreshIcon } from "../icons/index.js";
import { t } from "../i18n/index.js";
import { getEconomy } from "../api.js";

const report = ref(null);
const loaded = ref(false);
const failed = ref(false);
const busy = ref(false);

function formatInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("zh-CN", { maximumFractionDigits: 0 });
}

function formatUsd(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "$0";
  return "$" + n.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

function formatRate(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  if (n === 0) return "0";
  return String(parseFloat(n.toPrecision(6)));
}

const stageKey = computed(() => {
  const stage = report.value?.stage;
  if (stage === "seeding") return "economy.stageSeeding";
  if (stage === "growing") return "economy.stageGrowing";
  if (stage === "breakeven") return "economy.stageBreakeven";
  return "economy.stage";
});

const stageHintKey = computed(() => {
  const stage = report.value?.stage;
  if (stage === "seeding") return "economy.stageSeedingHint";
  if (stage === "growing") return "economy.stageGrowingHint";
  if (stage === "breakeven") return "economy.stageBreakevenHint";
  return "";
});

const progress = computed(() => {
  const recharge = Number(report.value?.rechargeUsd) || 0;
  const opex = Number(report.value?.monthlyOpexUsd) || 0;
  if (opex <= 0) return 0;
  return Math.min(100, Math.round((recharge / opex) * 100));
});

async function load() {
  busy.value = true;
  try {
    report.value = await getEconomy();
    failed.value = false;
  } catch {
    failed.value = true;
  } finally {
    loaded.value = true;
    busy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <h1 class="page-title">{{ t("economy.title") }}</h1>

  <p v-if="failed" class="error" role="alert">{{ t("error.request_failed") }}</p>

  <template v-else-if="loaded && report">
    <section class="card">
      <div class="rate-head">
        <span class="rate-icon" aria-hidden="true">
          <CoinIcon class="rate-coin" />
        </span>
        <div class="rate-copy">
          <h2 class="rate-label">{{ t("economy.rateCard") }}</h2>
          <p class="rate-value">
            <span class="rate-number">{{ formatRate(report.fiatPerPoint) }}</span>
            <span class="rate-unit">{{ t("economy.perPointUnit") }}</span>
          </p>
        </div>
      </div>
    </section>

    <section class="card">
      <h2 class="rate-label">{{ t("economy.breakeven") }}</h2>
      <div class="breakeven-line">
        <span class="stage-pill" :class="`stage-${report.stage}`">{{ t(stageKey) }}</span>
        <span class="breakeven-state" :class="report.breakeven ? 'is-balanced' : ''">
          {{ report.breakeven ? t("economy.breakevenYes") : t("economy.breakevenNo") }}
        </span>
      </div>
      <div class="progress-track" role="progressbar" :aria-valuenow="progress" aria-valuemin="0" aria-valuemax="100">
        <span class="progress-fill" :style="{ width: progress + '%' }"></span>
      </div>
      <p class="muted progress-hint">
        {{ t("economy.progressHint", { recharge: formatUsd(report.rechargeUsd), opex: formatUsd(report.monthlyOpexUsd) }) }}
      </p>
      <p class="muted stage-hint">{{ t(stageHintKey) }}</p>
    </section>

    <section class="card">
      <dl class="profile-facts economy-facts">
        <div>
          <dt>{{ t("economy.recharge") }}</dt>
          <dd>{{ formatUsd(report.rechargeUsd) }}</dd>
        </div>
        <div>
          <dt>{{ t("economy.opex") }}</dt>
          <dd>{{ formatUsd(report.monthlyOpexUsd) }}</dd>
        </div>
        <div>
          <dt>{{ t("economy.platformUsd") }}</dt>
          <dd>{{ formatUsd(report.platformUsd) }}</dd>
        </div>
        <div>
          <dt>{{ t("economy.supply") }}</dt>
          <dd>{{ formatInt(report.issued) }}</dd>
        </div>
        <div>
          <dt>{{ t("economy.circulating") }}</dt>
          <dd>{{ formatInt(report.circulating) }}</dd>
        </div>
        <div>
          <dt>{{ t("economy.platform") }}</dt>
          <dd>{{ formatInt(report.platform) }}</dd>
        </div>
      </dl>
      <div class="form-actions">
        <AppButton variant="secondary" :disabled="busy" @click="load">
          <RefreshIcon aria-hidden="true" />
          {{ t("economy.refresh") }}
        </AppButton>
      </div>
    </section>
  </template>
</template>
