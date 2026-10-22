<script setup>
import { computed, ref } from "vue";
import AppButton from "./AppButton.vue";
import { CheckIcon, CloseIcon } from "../icons/index.js";
import { t } from "../i18n/index.js";
import { getTips, tipInformation } from "../api.js";
import { errorText } from "../composers/packet.js";
import { useCardDialog } from "../composers/cardDialog.js";
import { useCardActionsStore } from "../stores/cardActions.js";
import { useSessionStore } from "../stores/session.js";

// 打赏小弹窗：硬币按键点开，选金额、看余额、确认。钱怎么走由后端决定，
// 这里只负责把结果和错误说清楚。
const PRESETS = [1, 5, 10, 20];
const DEFAULT_AMOUNT = PRESETS[1];
const DONE_CLOSE_MS = 1600;

const store = useCardActionsStore();
const session = useSessionStore();

const amountInput = ref(null);
const amount = ref(DEFAULT_AMOUNT);
// 标题要的称呼在选中那一刻记下来：弹窗关闭时 store 已经清空，不能再去读它。
const authorName = ref("");
const summary = ref({ total: 0, count: 0, given: 0 });
const error = ref("");
const busy = ref(false);
const done = ref(0);
let doneTimer = 0;
let summaryToken = 0;

const post = computed(() => store.tip);
const balance = computed(() => Number(session.user?.pointsBalance) || 0);
const chosen = computed(() => {
  const value = Number(amount.value);
  return Number.isInteger(value) && value > 0 ? value : 0;
});
const isSelf = computed(() => Boolean(post.value?.authorId && post.value.authorId === session.user?.id));
// 余额不够多少：0 表示够。
const shortfall = computed(() => Math.max(chosen.value - balance.value, 0));
const canSubmit = computed(
  () => Boolean(session.user && post.value?.id) && !isSelf.value && chosen.value > 0 && !shortfall.value && !busy.value,
);
const summaryText = computed(() => {
  const { count, total } = summary.value;
  if (!count) return t("home.tipTotalEmpty");
  return t(count === 1 ? "home.tipTotalOne" : "home.tipTotal", { count, total });
});

const { dialog, closeDialog, onBackdrop } = useCardDialog(() => store.tip, {
  onOpen(next) {
    reset();
    authorName.value = next.authorName || "";
  },
  afterOpen(next) {
    loadSummary(next.id);
    focusAmount();
  },
});

function reset() {
  clearTimeout(doneTimer);
  doneTimer = 0;
  amount.value = DEFAULT_AMOUNT;
  summary.value = { total: 0, count: 0, given: 0 };
  error.value = "";
  busy.value = false;
  done.value = 0;
  summaryToken += 1;
}

function close() {
  closeDialog();
  store.closeTip();
}

function choose(value) {
  amount.value = value;
  error.value = "";
}

// 手机上自动聚焦会立刻弹出数字键盘，把弹窗挡掉一半；只在有精确指针时才聚焦。
function focusAmount() {
  if (typeof window === "undefined") return;
  if (!window.matchMedia?.("(pointer: fine)").matches) return;
  amountInput.value?.focus({ preventScroll: true });
}

async function loadSummary(id) {
  const token = ++summaryToken;
  try {
    const data = await getTips(id);
    if (token !== summaryToken) return;
    applySummary(id, data);
  } catch {
    /* 摘要取不到不影响打赏，只少一行累计 */
  }
}

function applySummary(id, data) {
  summary.value = {
    total: Number(data?.total) || 0,
    count: Number(data?.count) || 0,
    given: Number(data?.given) || 0,
  };
  // 卡片上的累计跟着这次结果走，关掉弹窗后不用再等公开快照。
  store.rememberTipTotal(id, summary.value.total);
}

async function submit() {
  if (!canSubmit.value) return;
  // 请求期间用户仍可能改金额或关掉弹窗，先把要提交的值定下来。
  const id = post.value.id;
  const points = chosen.value;
  // 打开时发出的摘要请求可能比这次打赏更晚回来，先让它作废。
  summaryToken += 1;
  busy.value = true;
  error.value = "";
  try {
    const data = await tipInformation(id, points);
    applySummary(id, data);
    done.value = points;
    session.setBalance(data.balance);
    doneTimer = setTimeout(close, DONE_CLOSE_MS);
  } catch (err) {
    error.value = errorText(err.code, session.policy);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <dialog ref="dialog" class="card-tip" aria-labelledby="card-tip-title" @cancel.prevent="close" @click="onBackdrop">
    <header class="card-tip-head">
      <div class="card-tip-heading">
        <h2 id="card-tip-title" class="card-tip-title">
          {{ t("home.tipTitle", { name: authorName || t("home.author") }) }}
        </h2>
        <p class="card-tip-total">{{ summaryText }}</p>
        <p v-if="summary.given" class="card-tip-given">{{ t("home.tipGiven", { n: summary.given }) }}</p>
      </div>
      <AppButton variant="icon" plain class="card-tip-close" :aria-label="t('home.tipClose')" @click="close">
        <CloseIcon class="card-tip-close-icon" aria-hidden="true" />
      </AppButton>
    </header>

    <div v-if="!session.user" class="card-tip-body">
      <p class="card-tip-note">{{ t("home.tipNeedLogin") }}</p>
      <div class="card-tip-actions">
        <AppButton variant="secondary" @click="close">{{ t("home.tipLater") }}</AppButton>
        <AppButton to="/" @click="close">{{ t("remember.guestAction") }}</AppButton>
      </div>
    </div>

    <div v-else-if="done" class="card-tip-body card-tip-done" role="status">
      <span class="card-tip-done-mark" aria-hidden="true"><CheckIcon /></span>
      <p class="card-tip-done-text">{{ t("home.tipDone", { n: done }) }}</p>
    </div>

    <div v-else class="card-tip-body">
      <p class="card-tip-balance">{{ t("home.tipBalance", { n: balance }) }}</p>
      <p class="card-tip-label">{{ t("home.tipAmount") }}</p>
      <div class="tip-presets" role="group" :aria-label="t('home.tipAmount')">
        <button
          v-for="preset in PRESETS"
          :key="preset"
          type="button"
          class="tip-preset"
          :class="{ 'is-on': chosen === preset }"
          :aria-pressed="chosen === preset"
          :disabled="busy"
          @click="choose(preset)"
        >
          {{ preset }}
        </button>
      </div>
      <label class="tip-custom">
        <span class="tip-custom-label">{{ t("home.tipCustom") }}</span>
        <input
          ref="amountInput"
          v-model.number="amount"
          type="number"
          min="1"
          step="1"
          inputmode="numeric"
          :disabled="busy"
          :placeholder="t('home.tipCustomPlaceholder')"
          @input="error = ''"
        />
      </label>
      <p v-if="isSelf" class="card-tip-note">{{ t("home.tipSelf") }}</p>
      <p v-else-if="shortfall > 0" class="card-tip-note">{{ t("home.tipInsufficient", { n: shortfall }) }}</p>
      <p class="card-tip-hint">{{ t("home.tipHint") }}</p>
      <div class="card-tip-actions">
        <AppButton variant="secondary" @click="close">{{ t("home.tipCancel") }}</AppButton>
        <AppButton :disabled="!canSubmit" @click="submit">
          {{ chosen ? t("home.tipSubmit", { n: chosen }) : t("home.tipConfirm") }}
        </AppButton>
      </div>
      <p v-if="error" class="error card-tip-error" role="alert">{{ error }}</p>
    </div>
  </dialog>
</template>
