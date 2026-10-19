<script setup>
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import AppButton from "../components/AppButton.vue";
import { PencilIcon, RefreshIcon, UserIcon } from "../icons";
import { t } from "../i18n";
import { createDelegation, getDelegation, updateProfile, uploadImage } from "../api";
import { useSessionStore } from "../stores/session";

const router = useRouter();
const session = useSessionStore();
const error = ref("");
const busy = ref(false);
const agentCreatedAt = ref(null);
const agentDelegated = ref(false);
const agentBrief = ref("");
const agentBusy = ref(false);
const agentError = ref("");
let agentLoad = 0;
const name = ref("");
const editingName = ref(false);
const nameInput = ref(null);
const fileInput = ref(null);
const bio = ref("");
const editingBio = ref(false);
const bioInput = ref(null);

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
    agentDelegated.value = false;
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
  if (!Array.isArray(honors) || honors.length === 0) return t("mine.entitlementsEmpty");
  return honors.filter((item) => typeof item === "string" && item.trim()).join("、");
});

const muteLine = computed(() => {
  if (!session.user?.muted) return "";
  if (!session.user.mutedUntil) return t("mine.mutedForever");
  return t("mine.mutedUntil", { time: formatAgentTime(session.user.mutedUntil) });
});

const agentLine = computed(() => {
  if (!agentDelegated.value) return t("mine.agentCodeEmpty");
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
  const key = `error.${err.code}`;
  const message = t(key);
  error.value = message === key ? t("error.request_failed") : message;
}

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
    const img = await loadImage(file);
    if (img.naturalWidth !== img.naturalHeight || img.naturalWidth < 1) {
      error.value = t("error.bad_avatar_square");
      return;
    }
    const uploaded = await uploadImage(file);
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
    const data = await getDelegation();
    if (ticket !== agentLoad) return;
    agentDelegated.value = Boolean(data.delegated || data.createdAt);
    agentCreatedAt.value = data.createdAt || null;
  } catch (err) {
    if (ticket !== agentLoad) return;
    showAgentError(err);
  }
}

async function regenerate() {
  agentError.value = "";
  agentBusy.value = true;
  const ticket = ++agentLoad;
  try {
    const data = await createDelegation();
    if (ticket !== agentLoad) return;
    agentDelegated.value = true;
    agentCreatedAt.value = data.createdAt || new Date().toISOString();
    agentBrief.value = t("mine.agentBrief", {
      origin: window.location.origin,
      email: session.user?.email || "",
      token: data.token,
    });
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
          variant="icon"
          :aria-label="t('mine.agentRegenerate')"
          :disabled="agentBusy"
          @click="regenerate"
        >
          <RefreshIcon aria-hidden="true" />
        </AppButton>
      </div>
      <p v-if="agentError" class="error" role="alert">{{ agentError }}</p>
      <div class="agent-tips">
        <p class="agent-tips-title">{{ t("mine.agentTipsTitle") }}</p>
        <ul>
          <li>{{ t("mine.agentTipOnce") }}</li>
          <li>{{ t("mine.agentTipRotate") }}</li>
        </ul>
      </div>
      <pre v-if="agentBrief" class="agent-brief">{{ agentBrief }}</pre>
    </section>
  </template>
</template>
