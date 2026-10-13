<script setup>
import { computed, onMounted, onUnmounted, ref } from "vue";
import AppButton from "../components/AppButton.vue";
import DemandCard from "../components/DemandCard.vue";
import { createDemand, downloadInformation, listDemands, starInformation, stopDemand, unstarInformation, uploadAttachment } from "../api.js";
import { t } from "../i18n/index.js";
import { CameraIcon, PaperclipIcon, SendIcon } from "../icons/index.js";
import { useNotificationStore } from "../stores/notifications";
import { useSessionStore } from "../stores/session";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_IMAGES = 4;
const MAX_FILES = 1;
const VIDEO_FILE = /^video\/|\.(mp4|webm|mov|mkv|avi|m4v|mpeg|mpg|3gp|wmv|flv|ogv)$/i;
const AUDIO_FILE = /^audio\/|\.(mp3|m4a|wav|aac|ogg|oga|flac|opus|wma)$/i;

function isVideoFile(file) {
  return VIDEO_FILE.test(`${file?.type || ""} ${file?.name || ""}`);
}

function isAudioFile(file) {
  return AUDIO_FILE.test(`${file?.type || ""} ${file?.name || ""}`);
}

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
const editing = ref(false);
const stoppingId = ref("");
const downloadingId = ref("");
const stopNotice = ref("");
const stopNoticeId = ref("");

onMounted(load);
onUnmounted(clearPending);

async function downloadReply(reply) {
  if (downloadingId.value) return;
  reply.notice = "";
  downloadingId.value = reply.id;
  try {
    await downloadInformation(reply.id);
    const data = await listDemands();
    const next = (data.demands || []).flatMap((item) => item.replies || []).find((row) => row.id === reply.id);
    if (next) Object.assign(reply, next, { notice: "" });
    else reply.granted = true;
    await session.load();
  } catch (err) {
    const key = `error.${err.code}`;
    reply.notice = t(key) === key ? t("error.request_failed") : t(key);
  } finally {
    downloadingId.value = "";
  }
}

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
    if (isVideoFile(file)) {
      error.value = t("error.bad_video");
      continue;
    }
    if (isAudioFile(file)) {
      error.value = t("error.bad_audio");
      continue;
    }
    if (file.size > MAX_BYTES) {
      error.value = t("error.file_too_large");
      continue;
    }
    const image = String(file.type || "").startsWith("image/");
    const images = next.filter((item) => item.image).length;
    const files = next.length - images;
    if (image ? images >= MAX_IMAGES : files >= MAX_FILES) continue;
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
  if (item?.preview && item.file) URL.revokeObjectURL(item.preview);
  pending.value = pending.value.filter((_, i) => i !== index);
}

function beginEdit(demand) {
  if (demand.status === "open") return;
  clearPending();
  text.value = demand.brief || "";
  pending.value = [...(demand.images || []), ...(demand.attachments || [])].map((file) => ({
    id: file.id,
    name: file.name || t("buy.file"),
    image: Boolean(file.image || file.mime?.startsWith("image/")),
    preview: file.image || file.mime?.startsWith("image/") ? file.url : "",
  }));
  const kept = [];
  let images = 0;
  let files = 0;
  for (const item of pending.value) {
    if (item.image) {
      if (images >= MAX_IMAGES) continue;
      images += 1;
    } else {
      if (files >= MAX_FILES) continue;
      files += 1;
    }
    kept.push(item);
  }
  pending.value = kept;
  editing.value = true;
  error.value = "";
  document.getElementById("chat-text")?.focus();
}

function cancelEdit() {
  editing.value = false;
  text.value = "";
  clearPending();
  error.value = "";
}

async function toggleStar(reply) {
  if (!session.user || !reply?.starrable) return;
  const previous = Boolean(reply.starred);
  reply.starred = !previous;
  try {
    if (reply.starred) await starInformation(reply.id);
    else await unstarInformation(reply.id);
  } catch {
    reply.starred = previous;
  }
}

async function stop(demand) {
  if (demand.status !== "open" || stoppingId.value) return;
  stoppingId.value = demand.id;
  stopNotice.value = "";
  stopNoticeId.value = "";
  try {
    await stopDemand(demand.id);
    await load();
  } catch (err) {
    const key = `error.${err.code}`;
    stopNoticeId.value = demand.id;
    stopNotice.value = t(key) === key ? t("error.request_failed") : t(key);
  } finally {
    stoppingId.value = "";
  }
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
      if (item.id) {
        fileIds.push(item.id);
        continue;
      }
      const uploaded = await uploadAttachment(item.file);
      fileIds.push(uploaded.id);
    }
    await createDemand(brief, fileIds);
    text.value = "";
    clearPending();
    editing.value = false;
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
      <AppButton v-if="editing" variant="secondary" type="button" @click="cancelEdit">{{ t("buy.cancelEdit") }}</AppButton>
      <AppButton type="submit" :disabled="busy || !canSend" :aria-label="t('buy.send')">
        <SendIcon aria-hidden="true" />
        {{ t("buy.send") }}
      </AppButton>
    </div>
    <p v-if="editing" class="demand-note">{{ t("buy.editingHint") }}</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </form>

  <h2 class="chat-history-title">{{ t("buy.history") }}</h2>
  <p v-if="session.user && items.length === 0" class="muted">{{ t("buy.empty") }}</p>
  <DemandCard
    v-for="item in items"
    :key="item.id"
    :demand="item"
    :stopping="stoppingId === item.id"
    :notice="stopNoticeId === item.id ? stopNotice : ''"
    :downloading-id="downloadingId"
    @stop="stop(item)"
    @edit="beginEdit(item)"
    @star="toggleStar"
    @download="downloadReply"
  />
</template>
