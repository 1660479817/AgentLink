<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import AppButton from "../components/AppButton.vue";
import InformationCard from "../components/InformationCard.vue";
import { useRoute, useRouter } from "vue-router";
import { createBounty, createIntel, dismissInformation, downloadInformation, listBounties, listInformation, searchInformation, starInformation, unstarInformation, uploadAttachment, uploadImage } from "../api.js";
import { t } from "../i18n/index.js";
import { CameraIcon, ClockIcon, ComposeIcon, PaperclipIcon, PlusIcon, SendIcon, UserIcon } from "../icons/index.js";
import { useNotificationStore } from "../stores/notifications";
import { useSessionStore } from "../stores/session";

const items = ref([]);
const bounties = ref([]);
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
const intelPrice = ref("");
const intelBountyId = ref("");
const bountyHours = ref("24");
const intelCanSend = computed(() => {
  if (intelMode.value === "photo") return intelPendingImages.value.length > 0 || Boolean(intelBody.value.trim());
  if (intelMode.value === "text") return Boolean(intelBody.value.trim() || intelPendingFiles.value.length);
  if (intelMode.value === "bounty") return Boolean(intelBody.value.trim());
  return false;
});
const intelHasFiles = computed(
  () => intelPendingImages.value.length > 0 || intelPendingFiles.value.length > 0
);
const activeBounty = computed(() => bounties.value.find((item) => item.id === intelBountyId.value) || null);

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

function bountyLabel(bounty) {
  return t("home.bountyHours", { n: bounty.hours });
}

async function load() {
  try {
    const q = searchQ.value;
    const data = q ? await searchInformation(q) : await listInformation();
    items.value = data.information;
  } catch {
    items.value = [];
  }
  try {
    const data = await listBounties();
    bounties.value = data.bounties || [];
  } catch {
    bounties.value = [];
  }
}

function clearSearch() {
  router.push({ name: "home", query: {} });
}

async function dismissItem(item) {
  const previous = items.value;
  items.value = items.value.filter((row) => row.id !== item.id);
  try {
    await dismissInformation(item.id);
  } catch (error) {
    if (error.status !== 401) items.value = previous;
  }
}

async function toggleStar(item) {
  if (!session.user) return;
  const previous = Boolean(item.starred);
  item.starred = !previous;
  try {
    if (item.starred) await starInformation(item.id);
    else await unstarInformation(item.id);
  } catch {
    item.starred = previous;
  }
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
  if (intelOpen.value && !intelBountyId.value) {
    closeIntelComposer();
    return;
  }
  intelError.value = "";
  intelMode.value = null;
  intelBody.value = "";
  intelPrice.value = "";
  intelBountyId.value = "";
  intelPendingImages.value = [];
  clearIntelPreviews();
  clearIntelFiles();
  intelOpen.value = true;
}

function openBountySubmit(bounty) {
  intelError.value = "";
  intelBody.value = "";
  intelPrice.value = "";
  intelBountyId.value = bounty.id;
  intelPendingImages.value = [];
  clearIntelPreviews();
  clearIntelFiles();
  intelMode.value = "text";
  intelOpen.value = true;
}

function closeIntelComposer() {
  intelOpen.value = false;
  intelMode.value = null;
  intelError.value = "";
  intelBody.value = "";
  intelPrice.value = "";
  intelBountyId.value = "";
  intelPendingImages.value = [];
  clearIntelPreviews();
  clearIntelFiles();
}

function readPrice() {
  const raw = intelPrice.value.trim();
  if (!raw) return undefined;
  if (!/^\d+$/.test(raw)) return undefined;
  return Number(raw);
}

async function downloadItem(item) {
  item.notice = "";
  try {
    await ensureSession();
    const data = await downloadInformation(item.id);
    const intel = data.intel;
    item.images = intel.images || [];
    item.attachments = intel.attachments || [];
    item.imageUrls = (intel.images || []).map((file) => file.url).filter(Boolean);
    item.granted = true;
    if (session.user) await session.load();
  } catch (err) {
    const key = `error.${err.code}`;
    item.notice = t(key) === key ? t("error.request_failed") : t(key);
  }
}

async function submitIntel() {
  if (!intelCanSend.value) return;
  intelError.value = "";
  intelBusy.value = true;
  try {
    await ensureSession();
    if (intelMode.value === "bounty") {
      const hours = Number(bountyHours.value);
      await createBounty(intelBody.value.trim(), hours);
    } else {
      const imageIds = intelMode.value === "photo" ? await uploadAll(intelPendingImages.value) : [];
      const fileIds = [];
      if (intelMode.value === "text") {
        for (const item of intelPendingFiles.value) {
          const uploaded = await uploadAttachment(item.file);
          fileIds.push(uploaded.id);
        }
      }
      const extra = {};
      const price = readPrice();
      if (price !== undefined) extra.price = price;
      if (intelBountyId.value) extra.bountyId = intelBountyId.value;
      await createIntel(intelBody.value.trim(), imageIds, fileIds, extra);
    }
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
      <button
        v-for="bounty in bounties"
        :key="bounty.id"
        type="button"
        class="intel-bounty"
        @click="openBountySubmit(bounty)"
      >
        <span class="intel-bounty-body">
          <span class="intel-bounty-text">{{ bounty.body }}</span>
        </span>
        <span class="intel-bounty-reward">
          <ClockIcon class="intel-bounty-mark" aria-hidden="true" />
          <span>{{ bountyLabel(bounty) }}</span>
        </span>
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
      <button type="button" class="intel-mode-btn" @click="intelMode = 'bounty'">
        <ClockIcon class="intel-mode-icon" aria-hidden="true" />
        <span>{{ t("home.openBounty") }}</span>
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
      <div class="intel-send-composer">
        <label class="visually-hidden" for="intel-photo-caption">{{ t("home.intelPhotoCaption") }}</label>
        <input
          id="intel-photo-caption"
          v-model="intelBody"
          type="text"
          class="intel-send-input"
          :placeholder="t('home.intelPhotoCaption')"
        />
        <label v-if="intelHasFiles" class="visually-hidden" for="intel-photo-price">{{ t("home.priceLabel") }}</label>
        <input
          v-if="intelHasFiles"
          id="intel-photo-price"
          v-model="intelPrice"
          inputmode="numeric"
          class="composer-price"
          :placeholder="t('home.pricePlaceholder')"
        />
        <AppButton variant="icon" type="submit" class="intel-send-btn" :disabled="intelBusy || !intelCanSend" :aria-label="t('home.send')">
          <SendIcon aria-hidden="true" />
        </AppButton>
      </div>
      <p v-if="intelError" class="error" role="alert">{{ intelError }}</p>
    </form>

    <form v-else-if="intelMode === 'bounty'" class="composer-dialog" @submit.prevent="submitIntel">
      <div class="intel-text-composer">
        <label class="visually-hidden" for="bounty-body">{{ t("home.openBounty") }}</label>
        <textarea
          id="bounty-body"
          v-model="intelBody"
          rows="4"
          class="intel-text-input"
          :placeholder="t('home.bountyPlaceholder')"
        />
        <div class="intel-text-tools">
          <label class="visually-hidden" for="bounty-hours">{{ t("home.bountyHoursField") }}</label>
          <input
            id="bounty-hours"
            v-model="bountyHours"
            inputmode="numeric"
            class="composer-hours"
            :placeholder="t('home.bountyHoursField')"
          />
          <AppButton variant="icon" type="submit" class="intel-text-send" :disabled="intelBusy || !intelCanSend" :aria-label="t('home.send')">
            <SendIcon aria-hidden="true" />
          </AppButton>
        </div>
      </div>
      <p v-if="intelError" class="error" role="alert">{{ intelError }}</p>
    </form>

    <form v-else class="composer-dialog" @submit.prevent="submitIntel">
      <div class="intel-text-composer">
        <p v-if="activeBounty" class="composer-context">{{ t("home.bountySubmit") }}</p>
        <p v-if="activeBounty" class="composer-context-body">{{ activeBounty.body }}</p>
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
          <label v-if="intelHasFiles" class="visually-hidden" for="intel-file-price">{{ t("home.priceLabel") }}</label>
          <input
            v-if="intelHasFiles"
            id="intel-file-price"
            v-model="intelPrice"
            inputmode="numeric"
            class="composer-price"
            :placeholder="t('home.pricePlaceholder')"
          />
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
    :body="item.body || ''"
    :category="item.category || ''"
    :price="Number(item.price) || 0"
    :granted="item.granted !== false"
    :image-urls="item.imageUrls || item.images?.map((file) => file.url).filter(Boolean) || []"
    :images="item.images || []"
    :attachments="item.attachments || []"
    :author-name="item.author?.name || ''"
    :avatar-url="item.author?.avatarUrl || ''"
    :created-at="item.createdAt || ''"
    :starred="Boolean(item.starred)"
    :can-star="Boolean(session.user)"
    :notice="item.notice || ''"
    @dismiss="dismissItem(item)"
    @star="toggleStar(item)"
    @download="downloadItem(item)"
  />
  <p v-if="items.length === 0" class="muted feed-empty">
    {{ searchQ ? t("home.searchEmpty") : t("home.empty") }}
  </p>
</template>
