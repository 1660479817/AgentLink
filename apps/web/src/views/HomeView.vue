<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import AppButton from "../components/AppButton.vue";
import InformationCard from "../components/InformationCard.vue";
import { useRoute, useRouter } from "vue-router";
import { createExpression, listInformation, searchInformation, uploadImage } from "../api.js";
import { t } from "../i18n/index.js";
import { CameraIcon, ComposeIcon, PlusIcon, SendIcon, UploadIcon } from "../icons/index.js";
import { useMessageStore } from "../stores/messages";
import { useNotificationStore } from "../stores/notifications";
import { useSessionStore } from "../stores/session";

const open = ref(false);
const role = ref("demand");
const body = ref("");
const error = ref("");
const busy = ref(false);
const items = ref([]);
const intelOpen = ref(false);
const intelMode = ref(null);
const intelBody = ref("");
const intelError = ref("");
const intelBusy = ref(false);
const messages = useMessageStore();
const notifications = useNotificationStore();
const session = useSessionStore();
const contact = ref("");
const route = useRoute();
const router = useRouter();
const searchQ = computed(() => String(route.query.q || "").trim());
const imageInput = ref(null);
const pendingImages = ref([]);
const intelImageInput = ref(null);
const intelPendingImages = ref([]);
const intelPreviewUrls = ref([]);

const roles = [
  { id: "demand", label: "role.demand" },
  { id: "supply", label: "role.supply" },
];

onMounted(load);

watch(searchQ, load);

onUnmounted(clearIntelPreviews);

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

function pickImages(event, bucket) {
  const files = Array.from(event.target.files || []);
  bucket.value = [...bucket.value, ...files].slice(0, 6);
  event.target.value = "";
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

function selectIntelPhotoMode() {
  intelError.value = "";
  intelBody.value = "";
  intelPendingImages.value = [];
  clearIntelPreviews();
  intelMode.value = "photo";
}

function selectIntelTextMode() {
  intelError.value = "";
  intelBody.value = "";
  intelPendingImages.value = [];
  clearIntelPreviews();
  intelMode.value = "text";
}

async function ensureSession() {
  if (!session.person) await session.start();
}

async function uploadAll(files) {
  const ids = [];
  for (const file of files) {
    const data = await uploadImage(file);
    ids.push(data.id);
  }
  return ids;
}

async function submit() {
  error.value = "";
  busy.value = true;
  try {
    await ensureSession();
    const imageIds = await uploadAll(pendingImages.value);
    await createExpression(role.value, body.value.trim(), {
      imageIds,
      contact: contact.value.trim(),
    });
    body.value = "";
    contact.value = "";
    pendingImages.value = [];
    open.value = false;
    await load();
    await messages.load();
    await notifications.load();
  } catch (err) {
    const key = `error.${err.code}`;
    error.value = t(key) === key ? t("error.request_failed") : t(key);
  } finally {
    busy.value = false;
  }
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
  intelOpen.value = true;
}

function closeIntelComposer() {
  intelOpen.value = false;
  intelMode.value = null;
  intelError.value = "";
  intelBody.value = "";
  intelPendingImages.value = [];
  clearIntelPreviews();
}

async function submitIntel() {
  intelError.value = "";
  if (intelMode.value === "photo") {
    if (!intelPendingImages.value.length) {
      intelError.value = t("error.empty_intel_photo");
      return;
    }
  } else if (intelMode.value === "text") {
    if (!intelBody.value.trim()) {
      intelError.value = t("error.empty_intel_text");
      return;
    }
  } else {
    return;
  }
  intelBusy.value = true;
  try {
    await ensureSession();
    const imageIds =
      intelMode.value === "photo" ? await uploadAll(intelPendingImages.value) : [];
    const bodyToSend = intelBody.value.trim();
    await createExpression("intel", bodyToSend, { imageIds });
    closeIntelComposer();
    await load();
    await messages.load();
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

  <section class="card composer">
    <button v-if="!open" type="button" class="composer-open" @click="open = true">
      <span class="avatar" aria-hidden="true" />
      <span class="composer-pill">{{ t("home.composer") }}</span>
    </button>
    <form v-else class="composer-dialog" @submit.prevent="submit">
      <label class="visually-hidden" for="information-body">{{ t("home.composer") }}</label>
      <textarea
        id="information-body"
        v-model="body"
        rows="4"
        :placeholder="t('home.placeholder')"
        required
      />
      <label class="visually-hidden" for="information-contact">{{ t("home.contact") }}</label>
      <input
        id="information-contact"
        v-model="contact"
        type="text"
        class="composer-contact"
        :placeholder="t('home.contactPlaceholder')"
      />
      <div class="role-pills" role="radiogroup" :aria-label="t('home.kind')">
        <label v-for="item in roles" :key="item.id" class="role-pill" :class="{ 'is-selected': role === item.id }">
          <input v-model="role" type="radio" name="kind" :value="item.id" />
          {{ t(item.label) }}
        </label>
      </div>
      <div class="composer-media">
        <input
          ref="imageInput"
          type="file"
          accept="image/*"
          multiple
          class="visually-hidden"
          @change="pickImages($event, pendingImages)"
        />
        <button type="button" class="composer-media-btn" :aria-label="t('home.addImages')" @click="imageInput?.click()">
          <UploadIcon aria-hidden="true" />
          <span>{{ t("home.addImages") }}</span>
        </button>
        <p v-if="pendingImages.length" class="muted composer-media-count">
          {{ t("home.imageCount", { count: pendingImages.length }) }}
        </p>
        <p class="muted composer-media-hint">{{ t("home.mediaHint") }}</p>
      </div>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="form-actions">
        <AppButton type="submit" :disabled="busy">{{ t("home.publish") }}</AppButton>
        <AppButton variant="secondary" @click="open = false">{{ t("home.close") }}</AppButton>
      </div>
    </form>
  </section>

  <section class="card intel-rail" :aria-label="t('home.intelRail')">
    <div class="intel-rail-viewport">
      <button type="button" class="intel-create" @click="openIntelComposer">
        <span class="intel-create-photo" aria-hidden="true" />
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
        <AppButton variant="icon" type="submit" class="intel-send-btn" :disabled="intelBusy" :aria-label="t('home.send')">
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
        <AppButton variant="icon" type="submit" class="intel-text-send" :disabled="intelBusy" :aria-label="t('home.send')">
          <SendIcon aria-hidden="true" />
        </AppButton>
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
    :category="item.category || ''"
  />
  <p v-if="items.length === 0" class="muted feed-empty">
    {{ searchQ ? t("home.searchEmpty") : t("home.empty") }}
  </p>
</template>
