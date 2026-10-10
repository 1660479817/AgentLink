<script setup>
import { computed, onMounted, onUnmounted, ref } from "vue";
import AppButton from "../components/AppButton.vue";
import { createDemand, listDemands, uploadAttachment } from "../api.js";
import { t } from "../i18n/index.js";
import { CameraIcon, PaperclipIcon, SendIcon } from "../icons/index.js";
import { useNotificationStore } from "../stores/notifications";
import { useSessionStore } from "../stores/session";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 5;

const session = useSessionStore();
const notifications = useNotificationStore();
const text = ref("");
const canSend = computed(() => Boolean(text.value.trim() || pending.value.length));
const error = ref("");
const busy = ref(false);
const items = ref([]);
const pending = ref([]);
const imageInput = ref(null);
const fileInput = ref(null);

onMounted(load);
onUnmounted(clearPending);

async function load() {
  if (!session.user) {
    items.value = [];
    return;
  }
  try {
    const data = await listDemands();
    items.value = data.demands;
  } catch {
    items.value = [];
  }
}

function clearPending() {
  for (const item of pending.value) {
    if (item.preview) URL.revokeObjectURL(item.preview);
  }
  pending.value = [];
}

function addFiles(list) {
  error.value = "";
  const next = [...pending.value];
  for (const file of list) {
    if (next.length >= MAX_FILES) break;
    if (file.size > MAX_BYTES) {
      error.value = t("error.file_too_large");
      continue;
    }
    const image = String(file.type || "").startsWith("image/");
    next.push({
      file,
      name: file.name,
      image,
      preview: image ? URL.createObjectURL(file) : "",
    });
  }
  pending.value = next;
}

function onPick(event) {
  addFiles(Array.from(event.target.files || []));
  event.target.value = "";
}

function removePending(index) {
  const item = pending.value[index];
  if (item?.preview) URL.revokeObjectURL(item.preview);
  pending.value = pending.value.filter((_, i) => i !== index);
}

async function submit() {
  const brief = text.value.trim();
  if (!brief && !pending.value.length) return;
  error.value = "";
  busy.value = true;
  try {
    if (!session.user) {
      const err = new Error("no_session");
      err.code = "no_session";
      throw err;
    }
    const fileIds = [];
    for (const item of pending.value) {
      const uploaded = await uploadAttachment(item.file);
      fileIds.push(uploaded.id);
    }
    await createDemand(brief, fileIds);
    text.value = "";
    clearPending();
    await load();
    await notifications.load();
  } catch (err) {
    const key = `error.${err.code}`;
    error.value = t(key) === key ? t("error.request_failed") : t(key);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <h1 class="page-title">{{ t("buy.title") }}</h1>
  <form class="card chat-composer" @submit.prevent="submit">
    <label class="visually-hidden" for="chat-text">{{ t("buy.placeholder") }}</label>
    <textarea
      id="chat-text"
      v-model="text"
      rows="3"
      class="chat-box"
      :placeholder="t('buy.placeholder')"
    />
    <ul v-if="pending.length" class="chat-pending">
      <li v-for="(item, index) in pending" :key="`${item.name}-${index}`" class="chat-pending-item">
        <img v-if="item.image" :src="item.preview" alt="" class="chat-thumb" />
        <span v-else class="chat-file-name">{{ item.name }}</span>
        <AppButton variant="secondary" type="button" @click="removePending(index)">{{ t("buy.remove") }}</AppButton>
      </li>
    </ul>
    <div class="chat-tools">
      <input ref="imageInput" type="file" accept="image/*" multiple class="visually-hidden" @change="onPick" />
      <input ref="fileInput" type="file" multiple class="visually-hidden" @change="onPick" />
      <AppButton variant="icon" type="button" :aria-label="t('buy.addImage')" @click="imageInput?.click()">
        <CameraIcon aria-hidden="true" />
      </AppButton>
      <AppButton variant="icon" type="button" :aria-label="t('buy.addFile')" @click="fileInput?.click()">
        <PaperclipIcon aria-hidden="true" />
      </AppButton>
      <AppButton type="submit" :disabled="busy || !canSend" :aria-label="t('buy.send')">
        <SendIcon aria-hidden="true" />
        {{ t("buy.send") }}
      </AppButton>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </form>

  <h2 class="chat-history-title">{{ t("buy.history") }}</h2>
  <p v-if="session.user && items.length === 0" class="muted">{{ t("buy.empty") }}</p>
  <article v-for="item in items" :key="item.id" class="chat-turn">
    <div class="chat-mine">
      <p v-if="item.brief" class="chat-text">{{ item.brief }}</p>
      <div v-if="item.attachments?.length" class="chat-attachments">
        <template v-for="file in item.attachments" :key="file.id">
          <img v-if="file.image" :src="file.url" alt="" class="chat-thumb" />
          <a v-else class="chat-file-link" :href="file.url">{{ file.name || t("buy.file") }}</a>
        </template>
      </div>
    </div>
    <div v-if="item.body" class="chat-reply">
      <pre class="chat-text">{{ item.body }}</pre>
    </div>
  </article>
</template>
