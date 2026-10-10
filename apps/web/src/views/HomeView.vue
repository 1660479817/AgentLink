<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import AppButton from "../components/AppButton.vue";
import InformationCard from "../components/InformationCard.vue";
import { useRoute, useRouter } from "vue-router";
import { createIntel, listInformation, searchInformation, uploadAttachment, uploadImage } from "../api.js";
import { t } from "../i18n/index.js";
import { CameraIcon, ComposeIcon, PaperclipIcon, PlusIcon, SendIcon, UserIcon } from "../icons/index.js";
import { useNotificationStore } from "../stores/notifications";
import { useSessionStore } from "../stores/session";

const items = ref([]);
const intelOpen = ref(false);
const intelMode = ref(null);
const intelBody = ref("");
const intelError = ref("");
const intelBusy = ref(false);
const notifications = useNotificationStore();
const session = useSessionStore();
const route = useRoute();
const router = useRouter();
const searchQ = computed(() => String(route.query.q || "").trim());
const createMark = computed(() => nameMark(session.user));
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 5;

const intelImageInput = ref(null);
const intelFileInput = ref(null);
const intelPendingImages = ref([]);
const intelPreviewUrls = ref([]);
const intelPendingFiles = ref([]);
const intelCanSend = computed(() => {
  if (intelMode.value === "photo") return intelPendingImages.value.length > 0;
  if (intelMode.value === "text") return Boolean(intelBody.value.trim() || intelPendingFiles.value.length);
  return false;
});

function nameMark(user) {
  const name = String(user?.displayName || "").trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    const latin = parts.every((part) => /^[A-Za-z]/.test(part));
    if (latin && parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    if (latin) return parts[0].slice(0, 1).toUpperCase();
    const chars = Array.from(name.replace(/\s+/g, ""));
    return chars.slice(-2).join("");
  }
  const email = String(user?.email || "").trim();
  return email ? email.slice(0, 1).toUpperCase() : "";
}

onMounted(load);
watch(searchQ, load);
onUnmounted(() => {
  clearIntelPreviews();
  clearIntelFiles();
});

watch(intelMode, async (mode) => {
  if (mode !== "photo") return;
  await nextTick();
  openIntelCamera();
});

async function load() {
  try {
    const q = searchQ.value;
    const data = q ? await searchInformation(q) : await listInformation();
    items.value = data.information;
  } catch {
    items.value = [];
  }
}

function clearSearch() {
  router.push({ name: "home", query: {} });
}

function clearIntelPreviews() {
  for (const url of intelPreviewUrls.value) URL.revokeObjectURL(url);
  intelPreviewUrls.value = [];
}

function syncIntelPreviews() {
  clearIntelPreviews();
  intelPreviewUrls.value = intelPendingImages.value.map((file) => URL.createObjectURL(file));
}

function openIntelCamera() {
  if (intelPendingImages.value.length >= 3) return;
  intelImageInput.value?.click();
}

function pickIntelPhoto(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;
  intelPendingImages.value = [...intelPendingImages.value, files[0]].slice(0, 3);
  syncIntelPreviews();
  event.target.value = "";
}

function clearIntelFiles() {
  for (const item of intelPendingFiles.value) {
    if (item.preview) URL.revokeObjectURL(item.preview);
  }
  intelPendingFiles.value = [];
}

function addIntelFiles(list) {
  intelError.value = "";
  const next = [...intelPendingFiles.value];
  for (const file of list) {
    if (next.length >= MAX_FILES) break;
    if (file.size > MAX_BYTES) {
      intelError.value = t("error.file_too_large");
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
  intelPendingFiles.value = next;
}

function pickIntelFile(event) {
  addIntelFiles(Array.from(event.target.files || []));
  event.target.value = "";
}

function removeIntelFile(index) {
  const item = intelPendingFiles.value[index];
  if (item?.preview) URL.revokeObjectURL(item.preview);
  intelPendingFiles.value = intelPendingFiles.value.filter((_, i) => i !== index);
}

function selectIntelPhotoMode() {
  intelError.value = "";
  intelBody.value = "";
  intelPendingImages.value = [];
  clearIntelPreviews();
  clearIntelFiles();
  intelMode.value = "photo";
}

function selectIntelTextMode() {
  intelError.value = "";
  intelBody.value = "";
  intelPendingImages.value = [];
  clearIntelPreviews();
  clearIntelFiles();
  intelMode.value = "text";
}

function ensureSession() {
  if (session.user) return;
  const err = new Error("no_session");
  err.code = "no_session";
  throw err;
}

async function uploadAll(files) {
  const ids = [];
  for (const file of files) {
    const data = await uploadImage(file);
    ids.push(data.id);
  }
  return ids;
}

function openIntelComposer() {
  if (intelOpen.value) {
    closeIntelComposer();
    return;
  }
  intelError.value = "";
  intelMode.value = null;
  intelBody.value = "";
  intelPendingImages.value = [];
  clearIntelPreviews();
  clearIntelFiles();
  intelOpen.value = true;
}

function closeIntelComposer() {
  intelOpen.value = false;
  intelMode.value = null;
  intelError.value = "";
  intelBody.value = "";
  intelPendingImages.value = [];
  clearIntelPreviews();
  clearIntelFiles();
}

async function submitIntel() {
  if (!intelCanSend.value) return;
  intelError.value = "";
  intelBusy.value = true;
  try {
    await ensureSession();
    const imageIds = intelMode.value === "photo" ? await uploadAll(intelPendingImages.value) : [];
    const fileIds = [];
    if (intelMode.value === "text") {
      for (const item of intelPendingFiles.value) {
        const uploaded = await uploadAttachment(item.file);
        fileIds.push(uploaded.id);
      }
    }
    await createIntel(intelBody.value.trim(), imageIds, fileIds);
    closeIntelComposer();
    await load();
    await notifications.load();
  } catch (err) {
    const key = `error.${err.code}`;
    intelError.value = t(key) === key ? t("error.request_failed") : t(key);
  } finally {
    intelBusy.value = false;
  }
}
</script>

<template>
  <section v-if="searchQ" class="card search-context">
    <p class="search-context-label">{{ t("home.searchResults", { q: searchQ }) }}</p>
    <AppButton variant="secondary" @click="clearSearch">{{ t("home.clearSearch") }}</AppButton>
  </section>

  <section class="card intel-rail" :aria-label="t('home.intelRail')">
    <div class="intel-rail-viewport">
      <button type="button" class="intel-create" @click="openIntelComposer">
        <span class="intel-create-photo" aria-hidden="true">
          <img v-if="session.user?.avatarUrl" :src="session.user.avatarUrl" alt="" />
          <span v-else-if="createMark">{{ createMark }}</span>
          <UserIcon v-else />
        </span>
        <span class="intel-create-plus" aria-hidden="true">
          <PlusIcon />
        </span>
        <span class="intel-create-label">{{ t("home.intelCreate") }}</span>
      </button>
    </div>
  </section>

  <section v-if="intelOpen" class="card composer intel-compose">
    <div v-if="!intelMode" class="intel-mode-picker">
      <button type="button" class="intel-mode-btn" @click="selectIntelPhotoMode">
        <CameraIcon class="intel-mode-icon" aria-hidden="true" />
        <span>{{ t("home.intelPhoto") }}</span>
      </button>
      <button type="button" class="intel-mode-btn" @click="selectIntelTextMode">
        <ComposeIcon class="intel-mode-icon" aria-hidden="true" />
        <span>{{ t("home.intelInput") }}</span>
      </button>
    </div>

    <form v-else-if="intelMode === 'photo'" class="composer-dialog intel-photo-form" @submit.prevent="submitIntel">
      <input
        ref="intelImageInput"
        type="file"
        accept="image/*"
        capture="environment"
        class="visually-hidden"
        @change="pickIntelPhoto"
      />
      <div class="intel-photo-grid" :aria-label="t('home.intelCapture')">
        <div v-for="slot in 3" :key="slot" class="intel-photo-slot">
          <img
            v-if="intelPreviewUrls[slot - 1]"
            :src="intelPreviewUrls[slot - 1]"
            alt=""
            class="intel-photo-preview"
          />
          <button
            v-else-if="slot === intelPendingImages.length + 1 && intelPendingImages.length < 3"
            type="button"
            class="intel-photo-add"
            :aria-label="slot === 1 ? t('home.intelCapture') : t('home.intelAddPhoto')"
            @click="openIntelCamera"
          >
            <CameraIcon class="intel-camera-icon" aria-hidden="true" />
          </button>
        </div>
      </div>
      <p v-if="intelError" class="error" role="alert">{{ intelError }}</p>
      <div class="intel-send-composer">
        <label class="visually-hidden" for="intel-photo-caption">{{ t("home.intelPhotoCaption") }}</label>
        <input
          id="intel-photo-caption"
          v-model="intelBody"
          type="text"
          class="intel-send-input"
          :placeholder="t('home.intelPhotoCaption')"
        />
        <AppButton variant="icon" type="submit" class="intel-send-btn" :disabled="intelBusy || !intelCanSend" :aria-label="t('home.send')">
          <SendIcon aria-hidden="true" />
        </AppButton>
      </div>
    </form>

    <form v-else class="composer-dialog" @submit.prevent="submitIntel">
      <div class="intel-text-composer">
        <label class="visually-hidden" for="intel-body">{{ t("home.intelInput") }}</label>
        <textarea
          id="intel-body"
          v-model="intelBody"
          rows="4"
          class="intel-text-input"
          :placeholder="t('home.intelPlaceholder')"
        />
        <ul v-if="intelPendingFiles.length" class="chat-pending">
          <li v-for="(item, index) in intelPendingFiles" :key="`${item.name}-${index}`" class="chat-pending-item">
            <img v-if="item.image" :src="item.preview" alt="" class="chat-thumb" />
            <span v-else class="chat-file-name">{{ item.name }}</span>
            <AppButton variant="secondary" type="button" :disabled="intelBusy" @click="removeIntelFile(index)">
              {{ t("home.remove") }}
            </AppButton>
          </li>
        </ul>
        <div class="intel-text-tools">
          <input ref="intelFileInput" type="file" multiple class="visually-hidden" @change="pickIntelFile" />
          <AppButton variant="icon" type="button" :disabled="intelBusy" :aria-label="t('home.addFile')" @click="intelFileInput?.click()">
            <PaperclipIcon aria-hidden="true" />
          </AppButton>
          <AppButton variant="icon" type="submit" class="intel-text-send" :disabled="intelBusy || !intelCanSend" :aria-label="t('home.send')">
            <SendIcon aria-hidden="true" />
          </AppButton>
        </div>
      </div>
      <p v-if="intelError" class="error" role="alert">{{ intelError }}</p>
    </form>
  </section>

  <InformationCard
    v-for="item in items"
    :key="item.id"
    :role="item.role"
    :body="item.body || ''"
    :image-urls="item.imageUrls || []"
    :attachments="item.attachments || []"
  />
  <p v-if="items.length === 0" class="muted feed-empty">
    {{ searchQ ? t("home.searchEmpty") : t("home.empty") }}
  </p>
</template>
