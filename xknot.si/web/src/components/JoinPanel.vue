<script setup>
import { computed, onMounted, ref } from "vue";

import { OPERATOR_EMAIL, OPERATOR_NAME } from "../lib/contact.js";

const props = defineProps({
  locale: { type: String, required: true },
  t: { type: Function, required: true },
});

// 部署入口与默认管理地址。地址不随语种变，所以不进 locale 文件。
const REPO_URL = "https://github.com/manwjh/AgentLink/tree/main/knot-platform";
const ADMIN_URL = "http://127.0.0.1:8080/admin";

// ---- 登录 ----

const step = ref("email"); // email | code | member
const email = ref("");
const code = ref("");
const overview = ref(null);
const notice = ref(""); // 一句提示，成功或失败都用它
const noticeKind = ref("info"); // info | error
const busy = ref(false);
const emailError = ref(false);
const codeError = ref(false);

const member = computed(() => overview.value?.member || null);
const site = computed(() => overview.value?.site || null);
const health = computed(() => overview.value?.health || null);
const stats = computed(() => overview.value?.stats || null);

const statusKey = computed(() => {
  const status = member.value?.status;
  if (status === "pending") return "status.pending";
  if (status === "suspended") return "status.suspended";
  if (status === "retired") return "status.retired";
  return "status.active";
});

const healthKey = computed(() => `status.${health.value?.status || "unknown"}`);

function when(value) {
  if (!value) return "—";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "—";
  return at.toLocaleString(props.locale, { dateStyle: "short", timeStyle: "short" });
}

function number(value) {
  return typeof value === "number" ? value.toLocaleString(props.locale) : "—";
}

function say(text, kind = "info") {
  notice.value = text;
  noticeKind.value = kind;
}

async function post(path, payload) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(payload),
    credentials: "same-origin",
  });
  const data = await response.json().catch(() => null);
  return { response, data };
}

function mailFailure(response) {
  if (response.status === 503) return props.t("join.mailOff");
  if (response.status === 429) return props.t("join.rate");
  return props.t("join.generic");
}

async function sendCode() {
  if (busy.value) return;
  // 空值先拦下来：让用户知道是这一格没填，而不是「系统没反应」。
  const value = email.value.trim();
  emailError.value = !value || !/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(value);
  if (emailError.value) {
    say(props.t("join.emailInvalid"), "error");
    return;
  }

  busy.value = true;
  try {
    const { response } = await post("/api/member/code", { email: value, locale: props.locale });
    if (!response.ok) {
      say(mailFailure(response), "error");
      return;
    }
    step.value = "code";
    code.value = "";
    codeError.value = false;
    say(props.t("join.codeSent", { ttl: props.t("join.ttl") }), "info");
    requestAnimationFrame(() => document.getElementById("member-code")?.focus());
  } catch {
    say(props.t("join.offline"), "error");
  } finally {
    busy.value = false;
  }
}

async function login() {
  if (busy.value) return;
  const value = code.value.replace(/\s+/g, "");
  codeError.value = !/^[0-9]{6}$/.test(value);
  if (codeError.value) {
    say(props.t("join.codeInvalid"), "error");
    return;
  }

  busy.value = true;
  try {
    const { response, data } = await post("/api/member/session", {
      email: email.value.trim(),
      code: value,
    });
    if (response.ok && data?.overview) {
      overview.value = data.overview;
      step.value = "member";
      notice.value = "";
      return;
    }
    if (data?.reason === "expired" || data?.reason === "too_many_attempts") {
      say(props.t("join.codeExpired"), "error");
    } else if (response.status === 403) {
      say(props.t("join.notMember"), "error");
    } else {
      say(props.t("join.badCode"), "error");
    }
  } catch {
    say(props.t("join.offline"), "error");
  } finally {
    busy.value = false;
  }
}

function changeEmail() {
  step.value = "email";
  code.value = "";
  notice.value = "";
  emailError.value = false;
  codeError.value = false;
}

async function logout() {
  if (busy.value) return;
  busy.value = true;
  try {
    await post("/api/member/logout", {});
  } catch {
    /* 清不掉 Cookie 也让界面先退出去，下一次请求还是有效会话的话会自己回来。 */
  } finally {
    overview.value = null;
    step.value = "email";
    notice.value = "";
    busy.value = false;
  }
}

onMounted(async () => {
  // 已有会话就直接进：用户从门户回来不该再收一次授权码。
  try {
    const response = await fetch("/api/member/session", {
      headers: { accept: "application/json" },
      credentials: "same-origin",
    });
    if (!response.ok) return;
    const data = await response.json();
    if (data?.overview) {
      overview.value = data.overview;
      step.value = "member";
    }
  } catch {
    /* 离线时保持登录表单，用户自己会看到发不出去。 */
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

    <!-- 已登录：本站的公开状态与自报计数。不提供任何修改入口。 -->
    <section v-if="step === 'member' && overview" class="member" aria-live="polite">
      <div class="member-head">
        <div class="member-id">
          <p class="member-name">{{ site.name }}</p>
          <a class="member-url" :href="site.url" target="_blank" rel="noopener">{{ site.url }}</a>
        </div>
        <span class="pill" :data-tone="member.status">{{ t(statusKey) }}</span>
      </div>

      <p v-if="site.tagline" class="member-tagline">{{ site.tagline }}</p>

      <dl class="member-facts">
        <div>
          <dt>{{ t("join.health") }}</dt>
          <dd>
            <span class="dot" :data-health="health.status" aria-hidden="true" />
            {{ t(healthKey) }}
            <span v-if="health.latencyMs != null" class="muted"> · {{ health.latencyMs }} ms</span>
          </dd>
        </div>
        <div>
          <dt>{{ t("join.posts") }}</dt>
          <dd>
            {{ stats?.posts?.total == null ? "—" : number(stats.posts.total) }}
            <span v-if="stats?.posts?.last24h != null" class="muted">
              · {{ t("join.last24h") }} {{ number(stats.posts.last24h) }}
            </span>
          </dd>
        </div>
        <div>
          <dt>{{ t("join.accounts") }}</dt>
          <dd>{{ stats?.accounts?.total == null ? "—" : number(stats.accounts.total) }}</dd>
        </div>
        <div>
          <dt>{{ t("join.cards") }}</dt>
          <dd>{{ number(overview.cards) }}</dd>
        </div>
      </dl>

      <p class="member-note">
        {{ t("join.checkedAt", { when: when(health.checkedAt) }) }}
        <template v-if="stats?.fetchedAt"> · {{ t("join.statsAt", { when: when(stats.fetchedAt) }) }}</template>
        <template v-if="!stats"> · {{ t("join.noStats") }}</template>
      </p>
      <p v-if="member.status === 'pending'" class="member-note warn">{{ t("join.pendingNote") }}</p>

      <div class="member-actions">
        <a class="member-link" :href="site.url" target="_blank" rel="noopener">{{ t("join.openSite") }}</a>
        <button type="button" class="quiet" :disabled="busy" @click="logout">{{ t("join.logout") }}</button>
      </div>
    </section>

    <!-- 未登录：邮箱 → 授权码。两格，没有密码。 -->
    <form v-else class="login" novalidate @submit.prevent="step === 'email' ? sendCode() : login()">
      <div class="field">
        <label for="member-email">{{ t("join.email") }}</label>
        <input
          id="member-email"
          v-model="email"
          type="email"
          inputmode="email"
          autocomplete="email"
          autocapitalize="none"
          spellcheck="false"
          maxlength="120"
          :readonly="step === 'code'"
          :placeholder="t('join.emailPlaceholder')"
          :aria-invalid="emailError"
          :aria-describedby="emailError ? 'member-email-error' : 'member-email-help'"
        />
        <p v-if="emailError" id="member-email-error" class="field-error">{{ t("join.emailInvalid") }}</p>
        <p v-else id="member-email-help" class="field-hint">{{ t("join.emailHint") }}</p>
      </div>

      <div v-if="step === 'code'" class="field">
        <label for="member-code">
          {{ t("join.code") }}
          <button type="button" class="inline-link" @click="changeEmail">{{ t("join.changeEmail") }}</button>
        </label>
        <input
          id="member-code"
          v-model="code"
          type="text"
          inputmode="numeric"
          autocomplete="one-time-code"
          maxlength="6"
          :placeholder="t('join.codePlaceholder')"
          :aria-invalid="codeError"
          :aria-describedby="codeError ? 'member-code-error' : 'member-code-help'"
        />
        <p v-if="codeError" id="member-code-error" class="field-error">{{ t("join.codeInvalid") }}</p>
        <p v-else id="member-code-help" class="field-hint">{{ t("join.codeHint") }}</p>
      </div>

      <p v-if="notice" class="notice" :class="noticeKind" role="status">{{ notice }}</p>

      <div class="login-actions">
        <button class="submit" type="submit" :disabled="busy">
          {{ busy ? t("join.working") : step === "email" ? t("join.sendCode") : t("join.login") }}
        </button>
        <button v-if="step === 'code'" type="button" class="quiet" :disabled="busy" @click="sendCode">
          {{ t("join.resend") }}
        </button>
      </div>
    </form>

    <p class="how-rule" aria-hidden="true" />

    <!-- 加入方式：门户不再收申请表，入口在节点自己的管理页。 -->
    <h2 class="how-title">{{ t("join.how") }}</h2>
    <p class="lede">{{ t("join.howLede") }}</p>

    <ol class="steps">
      <li>
        <span class="step-no" aria-hidden="true">01</span>
        <span class="step-copy">
          <span class="step-title">{{ t("join.step1") }}</span>
          <span class="step-desc">{{ t("join.step1desc") }}</span>
          <a class="step-link" :href="REPO_URL" target="_blank" rel="noopener">manwjh/AgentLink · knot-platform</a>
        </span>
      </li>
      <li>
        <span class="step-no" aria-hidden="true">02</span>
        <span class="step-copy">
          <span class="step-title">{{ t("join.step2") }}</span>
          <span class="step-desc">
            <code class="inline-code">{{ ADMIN_URL }}</code>
            {{ t("join.step2desc") }}
          </span>
        </span>
      </li>
      <li>
        <span class="step-no" aria-hidden="true">03</span>
        <span class="step-copy">
          <span class="step-title">{{ t("join.step3") }}</span>
          <span class="step-desc">{{ t("join.step3desc") }}</span>
        </span>
      </li>
      <li>
        <span class="step-no" aria-hidden="true">04</span>
        <span class="step-copy">
          <span class="step-title">{{ t("join.step4") }}</span>
          <span class="step-desc">{{ t("join.step4desc") }}</span>
        </span>
      </li>
    </ol>

    <p class="contact">
      <span class="contact-label">{{ t("join.contactLabel") }}</span>
      <span class="contact-name">{{ OPERATOR_NAME }}</span>
      <a class="contact-mail" :href="`mailto:${OPERATOR_EMAIL}`">{{ OPERATOR_EMAIL }}</a>
    </p>
    <p class="contact-hint">{{ t("join.contactHint") }}</p>

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

.how-title {
  font-size: clamp(1.3rem, 1.1rem + 1vw, 1.7rem);
}

.lede {
  max-width: 46ch;
  color: rgba(255, 255, 255, 0.86);
  font-size: 0.88rem;
  line-height: 1.6;
}

/* 登录：两格，纵向排 */
.login {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  margin-top: 0.3rem;
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

.field input {
  width: 100%;
  min-height: 42px;
  padding: 0.4rem 0.6rem;
  border: 1px solid rgba(255, 255, 255, 0.34);
  border-radius: 6px;
  background: rgba(58, 20, 0, 0.18);
  color: #ffffff;
  font-size: 0.9rem;
  transition:
    border-color 150ms ease,
    background 150ms ease;
}

.field input::placeholder {
  color: rgba(255, 255, 255, 0.8);
}

.field input:focus {
  outline: 2px solid rgba(255, 255, 255, 0.85);
  outline-offset: 1px;
  border-color: transparent;
  background: rgba(58, 20, 0, 0.3);
}

.field input[readonly] {
  background: rgba(58, 20, 0, 0.12);
  color: rgba(255, 255, 255, 0.9);
}

.field input[aria-invalid="true"] {
  border-color: #ffd7b0;
}

#member-code {
  font-family: var(--font-mono);
  font-size: 1.1rem;
  letter-spacing: 0.24em;
}

.field-error {
  color: #fff0dd;
  font-size: 0.7rem;
  font-weight: 600;
}

.field-hint {
  color: rgba(255, 255, 255, 0.72);
  font-size: 0.66rem;
  line-height: 1.45;
}

.inline-link,
.quiet {
  padding: 0;
  border: 0;
  background: none;
  color: #ffffff;
  font: inherit;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
  text-decoration-color: rgba(255, 255, 255, 0.5);
}

.inline-link {
  font-size: 0.66rem;
}

.quiet:disabled {
  opacity: 0.55;
  cursor: progress;
}

.notice {
  padding: 0.42rem 0.55rem;
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 5px;
  background: rgba(90, 26, 0, 0.18);
  color: #fff4e6;
  font-size: 0.75rem;
  line-height: 1.45;
}

.notice.error {
  border-color: rgba(255, 215, 176, 0.8);
  font-weight: 600;
}

.login-actions {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  margin-top: 0.1rem;
}

.submit {
  flex: 1 1 auto;
  min-height: 46px;
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

/* 已登录 */
.member {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  margin-top: 0.35rem;
  padding: 0.9rem 0.95rem 1rem;
  border: 1px solid rgba(255, 255, 255, 0.32);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.1);
}

.member-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.6rem;
}

.member-id {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}

.member-name {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1.1rem;
  font-weight: 650;
  line-height: 1.25;
}

.member-url {
  overflow: hidden;
  color: rgba(255, 255, 255, 0.82);
  font-family: var(--font-mono);
  font-size: 0.66rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pill {
  flex: 0 0 auto;
  padding: 0.16rem 0.5rem;
  border: 1px solid rgba(255, 255, 255, 0.45);
  border-radius: 999px;
  font-family: var(--font-mono);
  font-size: 0.6rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.pill[data-tone="active"] {
  background: #ffffff;
  color: #b53f08;
  border-color: #ffffff;
}

.pill[data-tone="pending"] {
  background: rgba(255, 255, 255, 0.16);
}

.member-tagline {
  margin: 0;
  color: rgba(255, 255, 255, 0.84);
  font-size: 0.78rem;
  line-height: 1.5;
}

.member-facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem 0.7rem;
  margin: 0.15rem 0 0;
}

.member-facts dt {
  font-family: var(--font-mono);
  font-size: 0.58rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.7);
}

.member-facts dd {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  margin: 0.12rem 0 0;
  font-size: 0.86rem;
  font-variant-numeric: tabular-nums;
}

.muted {
  color: rgba(255, 255, 255, 0.66);
  font-size: 0.72rem;
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.5);
}

.dot[data-health="up"] {
  background: #9ae6b4;
}

.dot[data-health="degraded"] {
  background: #fbd38d;
}

.dot[data-health="down"] {
  background: #ffb3a7;
}

.member-note {
  margin: 0;
  color: rgba(255, 255, 255, 0.7);
  font-size: 0.66rem;
  line-height: 1.5;
}

.member-note.warn {
  color: #fff0dd;
  font-weight: 600;
}

.member-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  margin-top: 0.15rem;
}

.member-link {
  color: #ffffff;
  font-size: 0.78rem;
  text-decoration: underline;
  text-underline-offset: 2px;
  text-decoration-color: rgba(255, 255, 255, 0.55);
}

/* 如何加入 */
.how-rule {
  height: 1px;
  margin: 0.55rem 0 0.35rem;
  background: rgba(255, 255, 255, 0.24);
}

.steps {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin: 0.25rem 0 0.1rem;
  padding: 0;
  list-style: none;
}

.steps li {
  display: flex;
  gap: 0.55rem;
  min-width: 0;
}

.step-no {
  flex: 0 0 auto;
  padding-top: 0.1rem;
  font-family: var(--font-mono);
  font-size: 0.64rem;
  letter-spacing: 0.12em;
  color: rgba(255, 255, 255, 0.78);
}

.step-copy {
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
  min-width: 0;
}

.step-title {
  font-size: 0.82rem;
  font-weight: 600;
}

.step-desc {
  color: rgba(255, 255, 255, 0.86);
  font-size: 0.72rem;
  line-height: 1.45;
}

.step-link {
  color: #ffffff;
  font-family: var(--font-mono);
  font-size: 0.66rem;
  text-decoration: underline;
  text-underline-offset: 2px;
  text-decoration-color: rgba(255, 255, 255, 0.5);
  overflow-wrap: anywhere;
}

.inline-code {
  padding: 0.05rem 0.25rem;
  border-radius: 4px;
  background: rgba(58, 20, 0, 0.28);
  font-family: var(--font-mono);
  font-size: 0.68rem;
  white-space: nowrap;
}

.contact {
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
  flex-wrap: wrap;
  margin: 0.3rem 0 0;
  font-size: 0.74rem;
  line-height: 1.4;
}

.contact-label {
  font-family: var(--font-mono);
  font-size: 0.6rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.72);
}

.contact-name {
  font-weight: 600;
}

.contact-mail {
  color: #ffffff;
  text-decoration: underline;
  text-underline-offset: 2px;
  text-decoration-color: rgba(255, 255, 255, 0.55);
}

.contact-hint {
  margin: -0.2rem 0 0;
  color: rgba(255, 255, 255, 0.72);
  font-size: 0.68rem;
  line-height: 1.45;
}

.terms {
  margin-top: 0.3rem;
  color: rgba(255, 255, 255, 0.82);
  font-size: 0.7rem;
  line-height: 1.55;
}

@media (max-width: 900px) {
  .field input {
    min-height: 44px;
    font-size: 0.95rem;
  }

  .submit {
    min-height: 48px;
  }
}

/* 右栏被压窄时收掉说明的第二行，保证登录键与四步都在首屏。 */
@container (max-width: 400px) {
  .lede {
    font-size: 0.82rem;
    line-height: 1.55;
  }

  .step-desc {
    font-size: 0.7rem;
  }

  .member-facts {
    gap: 0.4rem 0.5rem;
  }
}
</style>
