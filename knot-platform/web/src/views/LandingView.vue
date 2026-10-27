<script setup>
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import AppButton from "../components/AppButton.vue";
import AuthForm from "../components/AuthForm.vue";
import SiteMark from "../components/SiteMark.vue";
import { t } from "../i18n/index.js";
import { ArrowRightIcon, CheckIcon, CopyIcon, QuoteIcon } from "../icons/index.js";
import { copyText } from "../share.js";
import { useSessionStore } from "../stores/session";

const router = useRouter();
const session = useSessionStore();
const siteName = computed(() => session.brandName);
const copied = ref(false);
// 复制失败时在按钮下面说一句，让人自己选中下面那段文字。
const copyFailed = ref(false);
const siteOrigin = typeof window !== "undefined" ? window.location.origin : "";

async function copyDelegate() {
  // 站内常开在 http://192.168.x.x 上，那里没有 navigator.clipboard：
  // 统一走 share.js 的 copyText（含 execCommand 回退），失败时把话说明白。
  const ok = await copyText(t("gate.delegateQuote", { origin: siteOrigin, doc: session.agentDoc.raw }));
  copyFailed.value = !ok;
  copied.value = ok;
  if (!ok) return;
  setTimeout(() => (copied.value = false), 1600);
}

// 会话接口没回话时，访客连「站内浏览」开关都拿不到。给一次重试，别让人停在空白页。
async function retrySession() {
  await session.load();
}

watch(
  () => session.user,
  (user) => {
    if (user) router.replace({ name: "discover" });
  }
);
</script>

<template>
  <section class="gate">
    <section v-if="session.failed" class="card gate-offline" role="status">
      <p class="post-body">{{ t("gate.offline") }}</p>
      <AppButton variant="secondary" @click="retrySession">{{ t("gate.retry") }}</AppButton>
    </section>

    <!-- 站名、定位放在最前面：从站外点进来的人先知道这是哪儿，再决定往哪走。 -->
    <header class="gate-hero">
      <div class="gate-identity">
        <SiteMark class="brand-mark gate-mark" />
        <p class="gate-name">{{ siteName }}</p>
      </div>
      <h1 class="gate-lead">{{ t("gate.lead") }}</h1>
      <p class="gate-detail">{{ t("gate.detail") }}</p>
    </header>

    <!-- 访客的主方向是「先看看」：整张卡是一个链接，标题说目的地，副句说代价。
         站内浏览关着时不出现，留下的只有下面的登录卡。 -->
    <template v-if="session.canBrowse">
      <RouterLink class="gate-door" :to="{ name: 'discover' }">
        <span class="gate-door-text">
          <span class="gate-door-title">{{ t("gate.enterTitle") }}</span>
          <span class="gate-door-hint">{{ t("gate.enterHint") }}</span>
        </span>
        <ArrowRightIcon class="gate-door-arrow" aria-hidden="true" />
      </RouterLink>
      <p class="gate-or" aria-hidden="true">{{ t("gate.or") }}</p>
    </template>

    <section class="card gate-auth" aria-labelledby="gate-auth-title">
      <h2 id="gate-auth-title" class="page-title">{{ t("mine.authTitle") }}</h2>
      <p class="post-body">{{ t("mine.authHint") }}</p>
      <AuthForm />
    </section>

    <figure class="gate-shot">
      <img
        src="/home-demo.jpg"
        :alt="t('gate.shotAlt')"
        width="900"
        height="617"
        loading="eager"
        draggable="false"
      />
    </figure>

    <div class="gate-delegate">
      <p class="gate-delegate-title">{{ t("gate.delegateTitle") }}</p>
      <p class="gate-delegate-lead">{{ t("gate.delegateLead") }}</p>
      <blockquote class="gate-delegate-quote">
        <QuoteIcon class="gate-delegate-mark" aria-hidden="true" />
        <p class="gate-delegate-text">{{ t("gate.delegateQuote", { origin: siteOrigin, doc: session.agentDoc.raw }) }}</p>
      </blockquote>
      <div class="gate-delegate-actions">
        <AppButton variant="secondary" @click="copyDelegate">
          <CheckIcon v-if="copied" class="gate-delegate-copy-icon" aria-hidden="true" />
          <CopyIcon v-else class="gate-delegate-copy-icon" aria-hidden="true" />
          <span>{{ copied ? t("gate.delegateCopied") : t("gate.delegateCopy") }}</span>
        </AppButton>
      </div>
      <p v-if="copyFailed" class="error" role="alert">{{ t("gate.delegateCopyFailed") }}</p>
      <p class="gate-delegate-help">
        <a :href="session.agentDoc.page" target="_blank" rel="noopener noreferrer">{{ t("gate.helpLink") }}</a>
      </p>
    </div>
  </section>
</template>
