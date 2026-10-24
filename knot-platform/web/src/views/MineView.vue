<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import AppButton from "../components/AppButton.vue";
import { PencilIcon, RefreshIcon, UserIcon } from "../icons";
import { t } from "../i18n";
import { adminEntryState, adminUrl, isIntranetHost } from "../adminEntry";
import { getAgent, issueAgent, requestAdminHandoff, retireAgent, updateProfile, uploadImage } from "../api";
import { errorText, normalizeImageFile } from "../composers/packet.js";
import { listText } from "../format.js";
import { useLocaleStore } from "../stores/locale.js";
import { copyText } from "../share.js";
import { useSessionStore } from "../stores/session";

const router = useRouter();
const session = useSessionStore();
const locale = useLocaleStore();
const error = ref("");
const busy = ref(false);
const agentCreatedAt = ref(null);
const agentActive = ref(false);
const agentLimit = ref(1);
const agentSelfService = ref(true);
const agentBrief = ref("");
const agentBusy = ref(false);
const agentError = ref("");
const agentNote = ref("");
let agentLoad = 0;
const name = ref("");
const editingName = ref(false);
const nameInput = ref(null);
const fileInput = ref(null);
const bio = ref("");
const editingBio = ref(false);
const bioInput = ref(null);
// 管理后台的入口。只有主理人看得到；地址由后端给（实例自己的内网地址）。
const adminEntry = ref(null);
const adminBusy = ref(false);
const adminError = ref("");
const adminLink = ref("");
const adminCopied = ref(false);
let copiedTimer = 0;

onMounted(() => {
  if (session.user) session.load();
});

watch(
  () => session.user,
  (user) => {
    if (!user) router.replace({ name: "gate" });
  }
);

watch(
  () => session.user?.id,
  (id) => {
    agentBrief.value = "";
    agentError.value = "";
    agentCreatedAt.value = null;
    agentActive.value = false;
    editingName.value = false;
    if (!id) return;
    loadAgent();
  },
  { immediate: true }
);

const nameUnchanged = computed(
  () => name.value.trim() === (session.user?.displayName || "").trim()
);

const bioUnchanged = computed(
  () => bio.value.trim() === (session.user?.bio || "").trim()
);

const entitlementText = computed(() => {
  const honors = session.user?.entitlements?.honors;
  const list = Array.isArray(honors) ? honors.filter((item) => typeof item === "string" && item.trim()) : [];
  if (list.length === 0) return t("mine.entitlementsEmpty");
  // 顿号是中文写法；en 下要逗号。交给 Intl 按当前语种拼，不再写死分隔符。
  return listText(list, locale.current);
});

const muteLine = computed(() => {
  if (!session.user?.muted) return "";
  if (!session.user.mutedUntil) return t("mine.mutedForever");
  return t("mine.mutedUntil", { time: formatAgentTime(session.user.mutedUntil) });
});

const agentLine = computed(() => {
  if (!agentActive.value) return t("mine.agentCodeEmpty");
  if (!agentCreatedAt.value) return t("mine.agentCodeOnly", { code: t("mine.agentCodeMask") });
  return t("mine.agentCode", {
    code: t("mine.agentCodeMask"),
    time: formatAgentTime(agentCreatedAt.value),
  });
});

function formatAgentTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function showError(err) {
  error.value = errorText(err.code, session.policy);
}

// 管理后台在实例自己的内网地址上，不在这个域名上。这里换一枚 5 分钟的票据拼成链接：
// 同一内网点开就走，另一台内网设备复制过去即可。进去之后 30 天内不用再来一次。
// 还没问过后端时先按本页的地址猜：这一页本来就在内网上，多半就是同一台实例。
const pageOnIntranet = isIntranetHost(window.location.hostname);
const adminOnIntranet = computed(() => adminEntry.value?.onIntranet ?? pageOnIntranet);

async function fetchAdminLink() {
  adminError.value = "";
  adminBusy.value = true;
  try {
    const data = await requestAdminHandoff();
    adminEntry.value = adminEntryState({ hosts: data.hosts, pageOrigin: window.location.origin });
    const link = adminUrl(adminEntry.value.primary, data.ticket);
    if (!link) {
      adminError.value = t("mine.admin.unavailable");
      return "";
    }
    adminLink.value = link;
    return link;
  } catch (err) {
    adminError.value = errorText(err.code, session.policy, "mine.admin.failed");
    return "";
  } finally {
    adminBusy.value = false;
  }
}

async function openAdmin() {
  // 先同步开一个空标签，票据回来后再指过去：await 之后再 window.open 会被当成弹窗。
  // 开不出来（弹窗被拦）就退回同一标签，链接不丢。
  const tab = window.open("about:blank", "_blank");
  const link = await fetchAdminLink();
  if (!link) {
    tab?.close();
    return;
  }
  if (!tab) {
    window.location.assign(link);
    return;
  }
  tab.opener = null;
  tab.location.replace(link);
}

async function copyAdminLink() {
  const link = await fetchAdminLink();
  if (!link) return;
  adminCopied.value = await copyText(link);
  window.clearTimeout(copiedTimer);
  if (!adminCopied.value) return;
  copiedTimer = window.setTimeout(() => {
    adminCopied.value = false;
  }, 2000);
}

onUnmounted(() => {
  window.clearTimeout(copiedTimer);
});

function startEditName() {
  name.value = session.user?.displayName || "";
  error.value = "";
  editingName.value = true;
  nextTick(() => nameInput.value?.focus());
}

function cancelEditName() {
  editingName.value = false;
  name.value = session.user?.displayName || "";
  error.value = "";
}

async function saveName() {
  if (nameUnchanged.value) {
    cancelEditName();
    return;
  }
  error.value = "";
  busy.value = true;
  try {
    const data = await updateProfile({ displayName: name.value });
    session.user = data.user;
    editingName.value = false;
  } catch (err) {
    showError(err);
  } finally {
    busy.value = false;
  }
}

function startEditBio() {
  bio.value = session.user?.bio || "";
  error.value = "";
  editingBio.value = true;
  nextTick(() => bioInput.value?.focus());
}

function cancelEditBio() {
  editingBio.value = false;
  bio.value = session.user?.bio || "";
  error.value = "";
}

async function saveBio() {
  if (bioUnchanged.value) {
    cancelEditBio();
    return;
  }
  error.value = "";
  busy.value = true;
  try {
    const data = await updateProfile({ bio: bio.value });
    session.user = data.user;
    editingBio.value = false;
  } catch (err) {
    showError(err);
  } finally {
    busy.value = false;
  }
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(Object.assign(new Error("bad_avatar"), { code: "bad_avatar" }));
    };
    img.src = url;
  });
}

async function pickAvatar(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  if (!String(file.type || "").startsWith("image/")) {
    error.value = t("error.bad_mime");
    return;
  }
  error.value = "";
  busy.value = true;
  try {
    const normalized = await normalizeImageFile(file);
    const img = await loadImage(normalized);
    if (img.naturalWidth !== img.naturalHeight || img.naturalWidth < 1) {
      error.value = t("error.bad_avatar_square");
      return;
    }
    const uploaded = await uploadImage(normalized);
    const data = await updateProfile({ avatarUploadId: uploaded.id });
    session.user = data.user;
  } catch (err) {
    showError(err);
  } finally {
    busy.value = false;
  }
}

function showAgentError(err) {
  const key = `error.${err.code}`;
  const message = t(key);
  agentError.value = message === key ? t("error.request_failed") : message;
}

async function loadAgent() {
  if (!session.user) return;
  const ticket = ++agentLoad;
  try {
    const data = await getAgent();
    if (ticket !== agentLoad) return;
    const first = Array.isArray(data.agents) ? data.agents[0] : null;
    agentActive.value = Boolean(first);
    agentCreatedAt.value = first?.createdAt || null;
    agentLimit.value = data.limit || 1;
    agentSelfService.value = data.selfService !== false;
  } catch (err) {
    if (ticket !== agentLoad) return;
    showAgentError(err);
  }
}

async function regenerate() {
  agentError.value = "";
  agentNote.value = "";
  agentBusy.value = true;
  const ticket = ++agentLoad;
  try {
    const data = await issueAgent();
    if (ticket !== agentLoad) return;
    agentActive.value = true;
    agentCreatedAt.value = data.agent?.createdAt || new Date().toISOString();
    agentBrief.value = t("mine.agentBrief", {
      origin: window.location.origin,
      doc: session.agentDoc.raw,
      token: data.token,
    });
  } catch (err) {
    if (ticket !== agentLoad) return;
    showAgentError(err);
  } finally {
    if (ticket === agentLoad) agentBusy.value = false;
  }
}

// 停用留内容、清令牌；同一个身份下次还能被重新生成授权码复起。
async function retire() {
  if (!window.confirm(t("mine.agentRetireConfirm"))) return;
  agentError.value = "";
  agentNote.value = "";
  agentBusy.value = true;
  const ticket = ++agentLoad;
  try {
    await retireAgent();
    if (ticket !== agentLoad) return;
    agentActive.value = false;
    agentCreatedAt.value = null;
    agentBrief.value = "";
    agentNote.value = t("mine.agentRetired");
    session.refreshAgent();
  } catch (err) {
    if (ticket !== agentLoad) return;
    showAgentError(err);
  } finally {
    if (ticket === agentLoad) agentBusy.value = false;
  }
}

async function leave() {
  error.value = "";
  busy.value = true;
  try {
    await session.end();
  } catch (err) {
    showError(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <h1 class="page-title">{{ t("mine.title") }}</h1>

  <template v-if="session.user">
    <section v-if="session.user.admin" class="card admin-entry">
      <h2 class="page-title">{{ t("mine.admin.title") }}</h2>
      <p class="muted admin-entry-hint">{{ t("mine.admin.hint") }}</p>
      <p v-if="adminEntry && adminEntry.alternates.length" class="muted admin-entry-note">
        {{ t("mine.admin.other", { hosts: listText(adminEntry.alternates, locale.current) }) }}
      </p>
      <p v-if="adminLink" class="admin-entry-link"><code>{{ adminLink }}</code></p>
      <p v-if="adminError" class="error" role="alert">{{ adminError }}</p>
      <div class="form-actions">
        <AppButton
          :variant="adminOnIntranet ? 'primary' : 'secondary'"
          :disabled="adminBusy"
          @click="openAdmin"
        >{{ t("mine.admin.open") }}</AppButton>
        <AppButton
          :variant="adminOnIntranet ? 'secondary' : 'primary'"
          :disabled="adminBusy"
          @click="copyAdminLink"
        >{{ adminCopied ? t("mine.admin.copied") : t("mine.admin.copy") }}</AppButton>
      </div>
      <p class="muted profile-note">{{ t("mine.admin.note") }}</p>
    </section>

    <section class="card">
      <div class="profile-head">
        <AppButton
          variant="icon"
          class="profile-avatar"
          :aria-label="t('mine.avatar')"
          :disabled="busy"
          @click="fileInput?.click()"
        >
          <img v-if="session.user.avatarUrl" :src="session.user.avatarUrl" alt="" />
          <UserIcon v-else aria-hidden="true" />
        </AppButton>
        <input
          ref="fileInput"
          class="visually-hidden"
          type="file"
          accept="image/*"
          :aria-label="t('mine.avatar')"
          @change="pickAvatar"
        />
        <div v-if="!editingName" class="profile-name profile-name-view">
          <p class="profile-name-text" :class="{ 'is-empty': !session.user.displayName }">
            {{ session.user.displayName || t("mine.displayNamePlaceholder") }}
          </p>
          <AppButton variant="icon" :aria-label="t('mine.editName')" :disabled="busy" @click="startEditName">
            <PencilIcon aria-hidden="true" />
          </AppButton>
        </div>
        <form v-else class="profile-name" @submit.prevent="saveName">
          <label class="visually-hidden" for="display-name">{{ t("mine.displayName") }}</label>
          <input
            id="display-name"
            ref="nameInput"
            v-model="name"
            type="text"
            maxlength="40"
            :placeholder="t('mine.displayNamePlaceholder')"
            :disabled="busy"
          />
          <div class="form-actions">
            <AppButton type="submit" :disabled="busy || nameUnchanged || !name.trim()">{{ t("mine.save") }}</AppButton>
            <AppButton variant="secondary" type="button" :disabled="busy" @click="cancelEditName">
              {{ t("mine.cancel") }}
            </AppButton>
          </div>
        </form>
      </div>
      <div class="profile-bio">
        <div v-if="!editingBio" class="bio-line">
          <p class="bio-text" :class="{ 'is-empty': !session.user.bio }">
            {{ session.user.bio || t("mine.bioPlaceholder") }}
          </p>
          <AppButton variant="icon" :aria-label="t('mine.editBio')" :disabled="busy" @click="startEditBio">
            <PencilIcon aria-hidden="true" />
          </AppButton>
        </div>
        <form v-else class="bio-form" @submit.prevent="saveBio">
          <label class="visually-hidden" for="bio-input">{{ t("mine.bio") }}</label>
          <textarea
            id="bio-input"
            ref="bioInput"
            v-model="bio"
            rows="3"
            maxlength="200"
            :placeholder="t('mine.bioPlaceholder')"
            :disabled="busy"
          ></textarea>
          <div class="form-actions">
            <AppButton type="submit" :disabled="busy || bioUnchanged">{{ t("mine.save") }}</AppButton>
            <AppButton variant="secondary" type="button" :disabled="busy" @click="cancelEditBio">
              {{ t("mine.cancel") }}
            </AppButton>
          </div>
        </form>
      </div>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <dl class="profile-facts">
        <div>
          <dt>{{ t("mine.email") }}</dt>
          <dd>{{ session.user.email }}</dd>
        </div>
        <div>
          <dt>{{ t("mine.level") }}</dt>
          <dd>{{ session.user.level }}</dd>
        </div>
        <div>
          <dt>{{ t("mine.entitlements") }}</dt>
          <dd>{{ entitlementText }}</dd>
        </div>
        <div v-if="session.user.muted">
          <dt>{{ t("mine.muted") }}</dt>
          <dd>{{ muteLine }}</dd>
        </div>
        <div>
          <dt>{{ t("mine.points") }}</dt>
          <dd>{{ t("mine.pointsBalance", { balance: session.user.pointsBalance }) }}</dd>
        </div>
      </dl>
      <p class="muted profile-note">{{ t("mine.pointsHint") }}</p>
      <div class="form-actions">
        <AppButton variant="secondary" :disabled="busy" @click="leave">{{ t("mine.leave") }}</AppButton>
      </div>
    </section>

    <section class="card">
      <h2 class="page-title">{{ t("mine.agent") }}</h2>
      <div class="agent-line">
        <p>{{ agentLine }}</p>
        <AppButton
          v-if="agentSelfService"
          variant="icon"
          :aria-label="t('mine.agentRegenerate')"
          :disabled="agentBusy"
          @click="regenerate"
        >
          <RefreshIcon aria-hidden="true" />
        </AppButton>
      </div>
      <p v-if="!agentSelfService" class="muted profile-note">{{ t("mine.agentOwnerNote", { limit: agentLimit }) }}</p>
      <p v-if="agentError" class="error" role="alert">{{ agentError }}</p>
      <div class="agent-tips">
        <p class="agent-tips-title">{{ t("mine.agentTipsTitle") }}</p>
        <ul>
          <li>{{ t("mine.agentTipOnce") }}</li>
          <li>{{ t("mine.agentTipRotate") }}</li>
        </ul>
      </div>
      <pre v-if="agentBrief" class="agent-brief">{{ agentBrief }}</pre>
      <p v-if="agentNote" class="muted profile-note">{{ agentNote }}</p>
      <div v-if="agentSelfService && agentActive" class="form-actions">
        <AppButton variant="secondary" :disabled="agentBusy" @click="retire">{{ t("mine.agentRetire") }}</AppButton>
      </div>
    </section>
  </template>
</template>
