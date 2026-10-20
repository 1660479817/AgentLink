<script setup>
import { computed, nextTick, onMounted, ref } from "vue";

import { COUNTRY_CODES, REGION_GROUPS, groupOf } from "../lib/regions.js";

const props = defineProps({
  locale: { type: String, required: true },
  t: { type: Function, required: true },
});

const LIMITS = { name: 40, intro: 60, operator: 80, email: 120, tags: 5 };

const form = ref({
  name: "",
  url: "",
  intro: "",
  operator: "",
  email: "",
  region: "",
  timezone: "",
  tags: "",
  agree: false,
  website: "", // 蜜罐，正常用户看不见
});

const errors = ref({});
const status = ref("idle"); // idle | busy | done
const failure = ref("");
const reference = ref("");
const submittedAt = ref("");

const busy = computed(() => status.value === "busy");

// 国家名交给 Intl，语种切换后自动跟着变；取不到就退回代码。
const regionOptions = computed(() => {
  let names = null;
  try {
    names = new Intl.DisplayNames([props.locale], { type: "region" });
  } catch {
    names = null;
  }
  const order = new Map(REGION_GROUPS.map((key, index) => [key, index]));
  return [...COUNTRY_CODES]
    .map((code) => ({
      code,
      group: code === "GLOBAL" ? "global" : groupOf(code),
      label: code === "GLOBAL" ? props.t("region.global") : names?.of(code) || code,
    }))
    .sort((a, b) => {
      const byGroup = order.get(a.group) - order.get(b.group);
      if (byGroup !== 0) return byGroup;
      return a.label.localeCompare(b.label, props.locale);
    });
});

const timezones = computed(() => {
  try {
    return Intl.supportedValuesOf?.("timeZone") || [];
  } catch {
    return [];
  }
});

const introCount = computed(() => [...form.value.intro].length);
const tagCount = computed(() =>
  form.value.tags
    .split(/[,，、\s]+/)
    .map((tag) => tag.trim())
    .filter(Boolean).length
);

const summary = computed(() => {
  if (failure.value) return failure.value;
  return Object.keys(errors.value).length ? props.t("formError.summary") : "";
});

function fieldError(key) {
  const code = errors.value[key];
  if (!code) return "";
  const text = props.t(`formError.${key}`);
  return text === `formError.${key}` ? props.t("formError.generic") : text;
}

function check() {
  const next = {};
  const value = form.value;
  const name = [...value.name.trim()].length;
  if (name < 2 || name > LIMITS.name) next.name = "invalid";

  let urlOk = false;
  try {
    const url = new URL(value.url.trim());
    urlOk = url.protocol === "https:" && url.hostname.includes(".");
  } catch {
    urlOk = false;
  }
  if (!urlOk) next.url = "invalid";

  if (!value.operator.trim()) next.operator = "required";
  if (!/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(value.email.trim())) next.email = "invalid";
  if (!value.region) next.region = "required";
  if (!value.timezone.trim()) next.timezone = "required";

  const intro = [...value.intro.trim()].length;
  if (!intro || intro > LIMITS.intro) next.intro = "invalid";
  if (tagCount.value > LIMITS.tags) next.tags = "invalid";
  if (!value.agree) next.agree = "required";

  errors.value = next;
  return Object.keys(next).length === 0;
}

async function submit() {
  failure.value = "";
  if (!check()) {
    await nextTick();
    document.querySelector("[aria-invalid='true']")?.focus();
    return;
  }

  status.value = "busy";
  try {
    const response = await fetch("/api/applications", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        name: form.value.name.trim(),
        url: form.value.url.trim(),
        intro: form.value.intro.trim(),
        operator: form.value.operator.trim(),
        email: form.value.email.trim(),
        region: form.value.region,
        timezone: form.value.timezone.trim(),
        tags: form.value.tags,
        agree: form.value.agree,
        website: form.value.website,
        locale: props.locale,
      }),
    });

    const data = await response.json().catch(() => null);

    if (response.status === 201 && data?.application) {
      reference.value = data.application.id;
      submittedAt.value = data.application.createdAt || new Date().toISOString();
      status.value = "done";
      return;
    }

    status.value = "idle";
    if (response.status === 400 && data?.fields) {
      errors.value = data.fields;
      failure.value = "";
    } else if (response.status === 409) {
      failure.value = props.t("formError.duplicate");
    } else if (response.status === 429) {
      failure.value = props.t("formError.rate");
    } else {
      failure.value = props.t("formError.generic");
    }
  } catch {
    status.value = "idle";
    failure.value = props.t("formError.offline");
  }
}

function again() {
  form.value = {
    name: "",
    url: "",
    intro: "",
    operator: "",
    email: "",
    region: "",
    timezone: form.value.timezone,
    tags: "",
    agree: false,
    website: "",
  };
  errors.value = {};
  failure.value = "";
  reference.value = "";
  status.value = "idle";
}

onMounted(() => {
  // 时区先按访客浏览器取，运营者可以在表单里改。
  try {
    form.value.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    form.value.timezone = "UTC";
  }
});
</script>

<template>
  <div class="join">
    <p class="eyebrow">
      <span class="eyebrow-rule" aria-hidden="true" />
      {{ t("join.eyebrow") }}
    </p>

    <h2>{{ t("join.title") }}</h2>
    <p class="lede">{{ t("join.lede") }}</p>

    <ol class="steps">
      <li v-for="step in 3" :key="step">
        <span class="step-no" aria-hidden="true">0{{ step }}</span>
        <span class="step-copy">
          <span class="step-title">{{ t(`join.step${step}`) }}</span>
          <span class="step-desc">{{ t(`join.step${step}desc`) }}</span>
        </span>
      </li>
    </ol>

    <form v-if="status !== 'done'" class="form" novalidate @submit.prevent="submit">
      <div class="field">
        <label for="join-name">{{ t("form.name") }}</label>
        <input
          id="join-name"
          v-model="form.name"
          type="text"
          autocomplete="organization"
          :maxlength="LIMITS.name"
          :placeholder="t('form.namePlaceholder')"
          :aria-invalid="Boolean(errors.name)"
          :aria-describedby="errors.name ? 'join-name-error' : undefined"
        />
        <p v-if="errors.name" id="join-name-error" class="field-error">{{ fieldError("name") }}</p>
      </div>

      <div class="field">
        <label for="join-url">{{ t("form.url") }}</label>
        <input
          id="join-url"
          v-model="form.url"
          type="url"
          inputmode="url"
          autocomplete="url"
          placeholder="https://example.com"
          :aria-invalid="Boolean(errors.url)"
          :aria-describedby="errors.url ? 'join-url-error' : undefined"
        />
        <p v-if="errors.url" id="join-url-error" class="field-error">{{ fieldError("url") }}</p>
      </div>

      <div class="field">
        <label for="join-intro">
          {{ t("form.intro") }}
          <span class="counter">{{ introCount }}/{{ LIMITS.intro }}</span>
        </label>
        <textarea
          id="join-intro"
          v-model="form.intro"
          rows="2"
          :maxlength="LIMITS.intro"
          :placeholder="t('form.introPlaceholder')"
          :aria-invalid="Boolean(errors.intro)"
          :aria-describedby="errors.intro ? 'join-intro-error' : undefined"
        />
        <p v-if="errors.intro" id="join-intro-error" class="field-error">{{ fieldError("intro") }}</p>
      </div>

      <div class="pair">
        <div class="field">
          <label for="join-operator">{{ t("form.operator") }}</label>
          <input
            id="join-operator"
            v-model="form.operator"
            type="text"
            autocomplete="name"
            :maxlength="LIMITS.operator"
            :placeholder="t('form.operatorPlaceholder')"
            :aria-invalid="Boolean(errors.operator)"
            :aria-describedby="errors.operator ? 'join-operator-error' : undefined"
          />
          <p v-if="errors.operator" id="join-operator-error" class="field-error">{{ fieldError("operator") }}</p>
        </div>

        <div class="field">
          <label for="join-email">{{ t("form.email") }}</label>
          <input
            id="join-email"
            v-model="form.email"
            type="email"
            autocomplete="email"
            :maxlength="LIMITS.email"
            placeholder="you@example.com"
            :aria-invalid="Boolean(errors.email)"
            :aria-describedby="errors.email ? 'join-email-error' : undefined"
          />
          <p v-if="errors.email" id="join-email-error" class="field-error">{{ fieldError("email") }}</p>
        </div>
      </div>

      <div class="pair">
        <div class="field">
          <label for="join-region">{{ t("form.region") }}</label>
          <select
            id="join-region"
            v-model="form.region"
            :aria-invalid="Boolean(errors.region)"
            :aria-describedby="errors.region ? 'join-region-error' : undefined"
          >
            <option value="" disabled>{{ t("form.regionPlaceholder") }}</option>
            <option v-for="option in regionOptions" :key="option.code" :value="option.code">
              {{ option.label }}
            </option>
          </select>
          <p v-if="errors.region" id="join-region-error" class="field-error">{{ fieldError("region") }}</p>
        </div>

        <div class="field">
          <label for="join-timezone">{{ t("form.timezone") }}</label>
          <input
            id="join-timezone"
            v-model="form.timezone"
            type="text"
            list="join-timezone-list"
            autocomplete="off"
            spellcheck="false"
            :aria-invalid="Boolean(errors.timezone)"
            aria-describedby="join-timezone-help"
          />
          <datalist id="join-timezone-list">
            <option v-for="zone in timezones" :key="zone" :value="zone" />
          </datalist>
          <p v-if="errors.timezone" id="join-timezone-help" class="field-error">{{ fieldError("timezone") }}</p>
          <p v-else id="join-timezone-help" class="field-hint">{{ t("form.timezoneHint") }}</p>
        </div>
      </div>

      <div class="field">
        <label for="join-tags">
          {{ t("form.tags") }}
          <span class="counter">{{ t("form.optional") }}</span>
        </label>
        <input
          id="join-tags"
          v-model="form.tags"
          type="text"
          :placeholder="t('form.tagsPlaceholder')"
          :aria-invalid="Boolean(errors.tags)"
          :aria-describedby="errors.tags ? 'join-tags-error' : undefined"
        />
        <p v-if="errors.tags" id="join-tags-error" class="field-error">{{ fieldError("tags") }}</p>
      </div>

      <!-- 蜜罐：屏幕阅读器与键盘都跳过，填了就说明是脚本。 -->
      <div class="trap" aria-hidden="true">
        <label for="join-website">website</label>
        <input id="join-website" v-model="form.website" type="text" tabindex="-1" autocomplete="off" />
      </div>

      <label class="agree" :class="{ invalid: errors.agree }">
        <input v-model="form.agree" type="checkbox" />
        <span>{{ t("form.agree") }}</span>
      </label>

      <p v-if="summary" class="summary" role="alert">
        {{ summary }}
        <a href="#join-name" class="summary-link">{{ t("formError.review") }}</a>
      </p>

      <button class="submit" type="submit" :disabled="busy">
        {{ busy ? t("form.submitting") : t("form.submit") }}
      </button>
    </form>

    <div v-else class="done" role="status">
      <span class="done-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="m5 12.5 4.5 4.5L19 7.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </span>
      <h3>{{ t("done.title") }}</h3>
      <p>{{ t("done.body") }}</p>
      <dl class="done-meta">
        <div>
          <dt>{{ t("done.ref") }}</dt>
          <dd>{{ reference }}</dd>
        </div>
        <div>
          <dt>{{ t("done.at") }}</dt>
          <dd>{{ new Date(submittedAt).toLocaleString(locale) }}</dd>
        </div>
      </dl>
      <button type="button" class="again" @click="again">{{ t("done.again") }}</button>
    </div>

    <p class="terms">{{ t("join.terms") }}</p>
  </div>
</template>

<style scoped>
.join {
  display: flex;
  flex-direction: column;
  container-type: inline-size;
  gap: 0.55rem;
  color: #ffffff;
}

.eyebrow {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-family: var(--font-mono);
  font-size: 0.62rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.9);
}

.eyebrow-rule {
  width: 22px;
  height: 1px;
  background: currentColor;
}

h2 {
  margin: 0.15rem 0 0;
  font-family: var(--font-display);
  font-size: clamp(1.6rem, 1.2rem + 1.6vw, 2.15rem);
  font-weight: 650;
  line-height: 1.15;
  letter-spacing: -0.015em;
}

.lede {
  max-width: 46ch;
  color: rgba(255, 255, 255, 0.86);
  font-size: 0.88rem;
  line-height: 1.6;
}

/* 三步：一条横排，省下纵向高度 */
.steps {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.55rem;
  margin: 0.35rem 0 0.1rem;
  padding: 0.55rem 0 0;
  list-style: none;
  border-top: 1px solid rgba(255, 255, 255, 0.22);
}

.steps li {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}

.step-no {
  font-family: var(--font-mono);
  font-size: 0.64rem;
  letter-spacing: 0.12em;
  color: rgba(255, 255, 255, 0.78);
}

.step-copy {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}

.step-title {
  font-size: 0.8rem;
  font-weight: 600;
}

.step-desc {
  color: rgba(255, 255, 255, 0.86);
  font-size: 0.7rem;
  line-height: 1.4;
}

/* 表单 */
.form {
  display: flex;
  flex-direction: column;
  gap: 0.52rem;
  margin-top: 0.2rem;
}

.pair {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.52rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.24rem;
  min-width: 0;
}

.field label {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 0.72rem;
  letter-spacing: 0.04em;
  color: rgba(255, 255, 255, 0.95);
}

.counter {
  font-family: var(--font-mono);
  font-size: 0.6rem;
  color: rgba(255, 255, 255, 0.72);
}

.field input,
.field textarea,
.field select {
  width: 100%;
  min-height: 40px;
  padding: 0.4rem 0.6rem;
  border: 1px solid rgba(255, 255, 255, 0.34);
  border-radius: 6px;
  background: rgba(58, 20, 0, 0.18);
  color: #ffffff;
  font-size: 0.85rem;
  transition:
    border-color 150ms ease,
    background 150ms ease;
}

.field textarea {
  min-height: 62px;
  resize: vertical;
  line-height: 1.45;
}

.field select {
  color-scheme: light;
  appearance: none;
  background-image: linear-gradient(45deg, transparent 50%, rgba(255, 255, 255, 0.8) 50%),
    linear-gradient(135deg, rgba(255, 255, 255, 0.8) 50%, transparent 50%);
  background-position:
    calc(100% - 16px) 18px,
    calc(100% - 11px) 18px;
  background-size: 5px 5px, 5px 5px;
  background-repeat: no-repeat;
  padding-right: 1.8rem;
}

.field select option {
  color: #1b1208;
  background: #ffffff;
}

.field input::placeholder,
.field textarea::placeholder {
  color: rgba(255, 255, 255, 0.8);
}

.field input:focus,
.field textarea:focus,
.field select:focus {
  outline: 2px solid rgba(255, 255, 255, 0.85);
  outline-offset: 1px;
  border-color: transparent;
  background: rgba(58, 20, 0, 0.3);
}

.field input[aria-invalid="true"],
.field textarea[aria-invalid="true"],
.field select[aria-invalid="true"] {
  border-color: #ffd7b0;
  background: rgba(58, 20, 0, 0.3);
}

.field-error {
  color: #fff0dd;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.field-hint {
  color: rgba(255, 255, 255, 0.72);
  font-size: 0.66rem;
}

.trap {
  position: absolute;
  left: -9999px;
  width: 1px;
  height: 1px;
  overflow: hidden;
}

.agree {
  display: flex;
  align-items: flex-start;
  gap: 0.45rem;
  min-height: 44px;
  margin-top: 0.15rem;
  padding-block: 0.6rem;
  color: rgba(255, 255, 255, 0.9);
  font-size: 0.76rem;
  line-height: 1.45;
  cursor: pointer;
}

.agree.invalid {
  color: #fff0dd;
}

.agree input {
  width: 16px;
  height: 16px;
  margin: 0.1rem 0 0;
  accent-color: #ffffff;
  flex: 0 0 auto;
}

.summary {
  padding: 0.42rem 0.55rem;
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 5px;
  background: rgba(90, 26, 0, 0.18);
  color: #fff4e6;
  font-size: 0.75rem;
}

.summary-link {
  margin-left: 0.35rem;
  color: #ffffff;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.submit {
  width: 100%;
  min-height: 46px;
  margin-top: 0.25rem;
  padding: 0.5rem 1rem;
  border: 0;
  border-radius: 7px;
  background: #ffffff;
  color: #b53f08;
  font-size: 0.92rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  cursor: pointer;
  transition:
    background 160ms ease,
    transform 160ms ease;
}

.submit:hover {
  background: #fff4ec;
}

.submit:active {
  transform: translateY(1px);
}

.submit:disabled {
  opacity: 0.65;
  cursor: progress;
}

/* 提交成功 */
.done {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  margin-top: 0.4rem;
  padding: 1.1rem 1.1rem 1.2rem;
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.1);
}

.done-mark {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: #ffffff;
  color: #c2500c;
}

.done-mark svg {
  width: 20px;
  height: 20px;
}

.done h3 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1.2rem;
  font-weight: 650;
}

.done p {
  color: rgba(255, 255, 255, 0.84);
  font-size: 0.82rem;
  line-height: 1.55;
}

.done-meta {
  display: flex;
  gap: 1.4rem;
  flex-wrap: wrap;
  margin: 0.3rem 0 0;
}

.done-meta dt {
  font-family: var(--font-mono);
  font-size: 0.6rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.76);
}

.done-meta dd {
  margin: 0.1rem 0 0;
  font-family: var(--font-mono);
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
}

.again {
  align-self: flex-start;
  margin-top: 0.35rem;
  min-height: 36px;
  padding: 0.2rem 0;
  border: 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.5);
  background: none;
  color: #ffffff;
  font-size: 0.78rem;
  cursor: pointer;
}

.terms {
  margin-top: 0.15rem;
  color: rgba(255, 255, 255, 0.82);
  font-size: 0.7rem;
  line-height: 1.55;
}

@media (max-width: 900px) {
  .join {
    gap: 0.6rem;
  }

  .field input,
  .field textarea,
  .field select {
    min-height: 44px;
    font-size: 0.9rem;
  }

  .submit {
    min-height: 48px;
  }
}

/* 右栏被压窄（1024 桌面）时收掉步骤说明，保证提交键还在首屏。 */
@container (max-width: 400px) {
  h2 {
    font-size: 1.5rem;
  }

  .lede {
    font-size: 0.82rem;
    line-height: 1.55;
  }

  .steps {
    gap: 0.4rem;
    padding-top: 0.45rem;
  }

  .step-desc {
    display: none;
  }

  .step-title {
    font-size: 0.76rem;
  }

  .form {
    gap: 0.46rem;
  }

  /* 只在桌面窄右栏压缩高度；手机上仍按上面的 44px 触控尺寸。 */
  @media (min-width: 901px) {
    .field input,
    .field textarea,
    .field select {
      min-height: 38px;
    }
  }
}

@media (max-width: 520px) {
  .pair {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
