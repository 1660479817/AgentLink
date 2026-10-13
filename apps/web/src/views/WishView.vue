<script setup>
import { nextTick, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import AppButton from "../components/AppButton.vue";
import PacketMediaFields from "../components/PacketMediaFields.vue";
import VideoFrame from "../components/VideoFrame.vue";
import {
  createIntel,
  downloadInformation,
  listMyResponses,
  listRequestResponses,
  listRequests,
  listSubmissions,
  uploadAttachment,
  uploadAudio,
  uploadImage,
} from "../api.js";
import { errorText, readVideoLink, requireSession, usePacketMedia } from "../composers/packet.js";
import { acceptDownload } from "../download/consent.js";
import { t } from "../i18n/index.js";
import { AudioIcon, ImageIcon, PaperclipIcon, SendIcon, VideoIcon } from "../icons/index.js";
import { useSessionStore } from "../stores/session";

const session = useSessionStore();
const route = useRoute();
const wishes = ref([]);
const replies = ref([]);
const lane = ref("posted");
const loaded = ref(false);
const busy = ref(false);
const fields = ref(null);
const imageInput = ref(null);
const fileInput = ref(null);
const audioInput = ref(null);
const body = ref("");
const agreed = ref(false);
const {
  images,
  previewUrls,
  files,
  audio,
  video,
  videoOpen,
  price,
  error,
  addImages,
  removeImage,
  addFiles,
  removeFile,
  setAudio,
  removeAudio,
  reset: resetMedia,
} = usePacketMedia();

const canSend = () =>
  Boolean(body.value.trim() || video.value.trim() || images.value.length || files.value.length || audio.value);

function when(value) {
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return "";
  const minutes = Math.floor((Date.now() - then) / 60000);
  if (minutes < 1) return t("home.justNow");
  if (minutes < 60) return t("home.minutesAgo", { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("home.hoursAgo", { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t("home.daysAgo", { n: days });
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
  }).formatToParts(new Date(then));
  const month = parts.find((part) => part.type === "month")?.value || "";
  const day = parts.find((part) => part.type === "day")?.value || "";
  return t("home.postedOn", { month, day });
}

function statusKey(verdict) {
  if (verdict === "passed") return "submissions.statusPublished";
  if (verdict === "rejected") return "submissions.statusRejected";
  if (verdict === "removed") return "submissions.statusRemoved";
  return "submissions.statusPending";
}

function namesOf(item) {
  if (item.fileNames?.length) {
    return item.fileNames.map((file) => (typeof file === "string" ? file : file.name)).filter(Boolean);
  }
  return [...(item.images || []), ...(item.audio || []), ...(item.attachments || [])]
    .map((file) => file?.name)
    .filter(Boolean);
}

async function load() {
  if (!session.user) {
    wishes.value = [];
    replies.value = [];
    loaded.value = true;
    return;
  }
  try {
    const [listed, submitted, authored] = await Promise.all([
      listRequests().catch(() => ({ requests: [] })),
      listSubmissions().catch(() => ({ submissions: [] })),
      listMyResponses().catch(() => ({ responses: [] })),
    ]);
    const byId = new Map();
    for (const item of submitted.submissions || []) {
      if (item.kind !== "request") continue;
      byId.set(item.id, {
        id: item.id,
        body: item.body || "",
        videos: item.videos || [],
        fileNames: namesOf(item),
        previewUrl: item.previewUrl || "",
        verdict: item.verdict || "pending",
        rejectReason: item.rejectReason || "",
        createdAt: item.createdAt || "",
        responses: [],
      });
    }
    for (const item of listed.requests || []) {
      if (!item.mine) continue;
      const existing = byId.get(item.id);
      byId.set(item.id, {
        id: item.id,
        body: item.body || existing?.body || "",
        videos: item.videos || existing?.videos || [],
        fileNames: namesOf(item).length ? namesOf(item) : existing?.fileNames || [],
        previewUrl: item.previewUrl || existing?.previewUrl || "",
        verdict: existing?.verdict || "passed",
        rejectReason: existing?.rejectReason || "",
        createdAt: item.createdAt || existing?.createdAt || "",
        responses: [],
      });
    }
    const rows = [...byId.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    await Promise.all(
      rows
        .filter((item) => item.verdict === "passed")
        .map(async (item) => {
          try {
            const data = await listRequestResponses(item.id);
            item.responses = data.responses || [];
          } catch {
            item.responses = [];
          }
        })
    );
    wishes.value = rows;
    replies.value = (authored.responses || []).map((item) => ({
      ...item,
      fileNames: namesOf(item),
      wish: item.wish
        ? { ...item.wish, fileNames: namesOf(item.wish) }
        : null,
    }));
  } catch {
    wishes.value = [];
    replies.value = [];
  } finally {
    loaded.value = true;
  }
}

async function focusWish() {
  const id = String(route.query.wish || "");
  if (!id) return;
  lane.value = "posted";
  await nextTick();
  document.getElementById(`wish-${id}`)?.scrollIntoView({ block: "start" });
}

function selectLane(next) {
  lane.value = next;
}

onMounted(async () => {
  await load();
  await focusWish();
});
watch(() => route.query.wish, focusWish);

function pickImages(event) {
  addImages(Array.from(event.target.files || []));
  event.target.value = "";
}

function pickFiles(event) {
  addFiles(Array.from(event.target.files || []));
  event.target.value = "";
}

function pickAudio(event) {
  const file = Array.from(event.target.files || [])[0];
  event.target.value = "";
  if (file) setAudio(file);
}

async function submit() {
  if (!canSend() || !agreed.value || busy.value) return;
  error.value = "";
  const link = readVideoLink(video.value);
  if (link === null) {
    error.value = t("home.badVideo");
    return;
  }
  busy.value = true;
  try {
    requireSession(session.user);
    const imageIds = [];
    for (const file of images.value) {
      const data = await uploadImage(file);
      imageIds.push(data.id);
    }
    const fileIds = [];
    for (const item of files.value) {
      const uploaded = await uploadAttachment(item.file);
      fileIds.push(uploaded.id);
    }
    const extra = { request: true };
    if (audio.value) {
      const uploaded = await uploadAudio(audio.value.file);
      extra.audioIds = [uploaded.id];
    }
    if (link) extra.videos = [link];
    await createIntel(body.value.trim(), imageIds, fileIds, extra);
    body.value = "";
    agreed.value = false;
    resetMedia();
    await load();
  } catch (err) {
    error.value = errorText(err.code, session.policy);
  } finally {
    busy.value = false;
  }
}

async function downloadReply(item) {
  if (item.downloading) return;
  item.downloading = true;
  try {
    const ok = await acceptDownload({
      price: item.price,
      granted: item.granted !== false,
      code: session.user ? "" : "no_session",
      task: () => downloadInformation(item.id),
    });
    if (!ok) return;
    try {
      await load();
      if (session.user) await session.load();
    } catch {
      item.granted = true;
    }
  } finally {
    item.downloading = false;
  }
}
</script>

<template>
  <div class="wish-page">
    <h1 class="page-title">{{ t("wish.title") }}</h1>
    <p class="wish-lead">{{ t("wish.lead") }}</p>

    <section class="card share-bar" :aria-label="t('wish.title')">
      <form id="wish-form" class="share-dialog" @submit.prevent="submit">
        <PacketMediaFields
          ref="fields"
          v-model:body="body"
          v-model:video="video"
          v-model:price="price"
          body-id="wish-body"
          :body-label="t('wish.title')"
          :placeholder="t('wish.placeholder')"
          :rows="2"
          grow
          :video-open="videoOpen"
          :previews="previewUrls"
          :audio-name="audio?.name || ''"
          :files="files"
          :show-price="false"
          :show-free-note="false"
          price-id="wish-price"
          :busy="busy"
          @remove-image="removeImage"
          @remove-audio="removeAudio"
          @remove-file="removeFile"
        />
      </form>
      <div class="share-actions">
        <button type="button" class="share-action" :disabled="busy" @click="imageInput?.click()">
          <ImageIcon class="share-action-icon share-action-image" aria-hidden="true" />
          <span>{{ t("home.shareImage") }}</span>
        </button>
        <button type="button" class="share-action" :disabled="busy" @click="videoOpen = true">
          <VideoIcon class="share-action-icon share-action-video" aria-hidden="true" />
          <span>{{ t("home.shareVideo") }}</span>
        </button>
        <button type="button" class="share-action" :disabled="busy" @click="audioInput?.click()">
          <AudioIcon class="share-action-icon share-action-audio" aria-hidden="true" />
          <span>{{ t("home.shareAudio") }}</span>
        </button>
        <button type="button" class="share-action" :disabled="busy" @click="fileInput?.click()">
          <PaperclipIcon class="share-action-icon share-action-file" aria-hidden="true" />
          <span>{{ t("home.shareFile") }}</span>
        </button>
      </div>
      <div class="wish-submit-row">
        <label class="wish-consent">
          <input v-model="agreed" type="checkbox" :disabled="busy" />
          <span>{{ t("wish.consent", { fee: session.policy.requestFee ?? 1 }) }}</span>
        </label>
        <AppButton
          class="wish-send"
          variant="icon"
          type="submit"
          form="wish-form"
          :aria-label="t('wish.send')"
          :disabled="busy || !canSend() || !agreed"
        >
          <SendIcon aria-hidden="true" />
        </AppButton>
      </div>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <input ref="imageInput" type="file" accept="image/*" multiple class="visually-hidden" @change="pickImages" />
      <input ref="fileInput" type="file" multiple class="visually-hidden" @change="pickFiles" />
      <input ref="audioInput" type="file" accept="audio/*" class="visually-hidden" @change="pickAudio" />
    </section>

    <div class="card wish-lanes" role="tablist" :aria-label="t('wish.lanes')">
      <button
        id="wish-tab-posted"
        type="button"
        class="wish-lane"
        role="tab"
        :class="{ 'is-active': lane === 'posted' }"
        :aria-selected="lane === 'posted'"
        aria-controls="wish-panel-posted"
        @click="selectLane('posted')"
      >
        {{ t("wish.posted") }}
      </button>
      <button
        id="wish-tab-replied"
        type="button"
        class="wish-lane"
        role="tab"
        :class="{ 'is-active': lane === 'replied' }"
        :aria-selected="lane === 'replied'"
        aria-controls="wish-panel-replied"
        @click="selectLane('replied')"
      >
        {{ t("wish.replied") }}
      </button>
    </div>

    <div v-if="lane === 'posted'" id="wish-panel-posted" role="tabpanel" aria-labelledby="wish-tab-posted">
    <section v-if="loaded && !session.user" class="card wish-empty">
      <p>{{ t("wish.login") }}</p>
      <AppButton variant="secondary" to="/mine">{{ t("wish.loginAction") }}</AppButton>
    </section>
    <section v-else-if="loaded && wishes.length === 0" class="card wish-empty">
      <p>{{ t("wish.empty") }}</p>
    </section>

    <article
      v-for="wish in wishes"
      :id="`wish-${wish.id}`"
      :key="wish.id"
      class="card post wish-card"
      :class="{ 'is-current': String(route.query.wish || '') === wish.id }"
    >
      <div class="wish-card-head">
        <p v-if="wish.verdict !== 'passed'" class="information-status">{{ t(statusKey(wish.verdict)) }}</p>
        <p v-if="when(wish.createdAt)" class="information-time">{{ when(wish.createdAt) }}</p>
      </div>
      <p v-if="wish.verdict === 'rejected' && wish.rejectReason" class="wish-reason">{{ wish.rejectReason }}</p>
      <p v-if="wish.body" class="information-body">{{ wish.body }}</p>
      <img v-if="wish.previewUrl" :src="wish.previewUrl" alt="" class="information-preview" />
      <ul v-if="wish.fileNames.length" class="wish-files">
        <li v-for="(name, index) in wish.fileNames" :key="`${name}-${index}`" class="wish-file">
          <PaperclipIcon class="wish-file-icon" aria-hidden="true" />
          <span>{{ name }}</span>
        </li>
      </ul>
      <VideoFrame v-if="wish.videos?.[0]" :url="wish.videos[0].url" :poster="wish.videos[0].poster || ''" />
      <div class="wish-responses">
        <p class="wish-responses-label">{{ t("wish.responses") }}</p>
        <p v-if="wish.verdict === 'passed' && !wish.responses.length" class="muted">{{ t("wish.responsesEmpty") }}</p>
        <p v-else-if="wish.verdict !== 'passed'" class="muted">{{ t("wish.responsesWait") }}</p>
        <div v-for="item in wish.responses" :key="item.id" class="wish-response">
          <p class="bounty-reply-meta">
            <span>{{ item.author?.name || t("home.author") }}</span>
            <span v-if="when(item.createdAt)"> · {{ when(item.createdAt) }}</span>
          </p>
          <p v-if="item.body" class="bounty-reply-body">{{ item.body }}</p>
          <img v-if="item.previewUrl" :src="item.previewUrl" alt="" class="information-preview" />
          <ul v-if="item.fileNames?.length" class="wish-files">
            <li v-for="(name, index) in item.fileNames" :key="`${name}-${index}`" class="wish-file">
              <PaperclipIcon class="wish-file-icon" aria-hidden="true" />
              <span>{{ name }}</span>
            </li>
          </ul>
          <VideoFrame v-if="item.videos?.[0]" :url="item.videos[0].url" :poster="item.videos[0].poster || ''" />
          <AppButton
            v-if="item.fileNames?.length"
            variant="secondary"
            type="button"
            :disabled="item.downloading"
            @click="downloadReply(item)"
          >
            {{ t("wish.download") }}
          </AppButton>
        </div>
      </div>
    </article>
    </div>

    <div v-else id="wish-panel-replied" role="tabpanel" aria-labelledby="wish-tab-replied">
      <section v-if="loaded && !session.user" class="card wish-empty">
        <p>{{ t("wish.login") }}</p>
        <AppButton variant="secondary" to="/mine">{{ t("wish.loginAction") }}</AppButton>
      </section>
      <section v-else-if="loaded && replies.length === 0" class="card wish-empty">
        <p>{{ t("wish.repliedEmpty") }}</p>
      </section>
      <article v-for="item in replies" :key="item.id" class="card post wish-card">
        <div class="wish-target">
          <p class="wish-responses-label">{{ t("wish.replyTo") }}</p>
          <template v-if="item.wish">
            <p v-if="item.wish.body" class="information-body">{{ item.wish.body }}</p>
            <img v-if="item.wish.previewUrl" :src="item.wish.previewUrl" alt="" class="information-preview" />
            <ul v-if="item.wish.fileNames.length" class="wish-files">
              <li v-for="(name, index) in item.wish.fileNames" :key="`${name}-${index}`" class="wish-file">
                <PaperclipIcon class="wish-file-icon" aria-hidden="true" />
                <span>{{ name }}</span>
              </li>
            </ul>
            <VideoFrame v-if="item.wish.videos?.[0]" :url="item.wish.videos[0].url" :poster="item.wish.videos[0].poster || ''" />
          </template>
          <p v-else class="muted">{{ t("wish.replyMissing") }}</p>
        </div>
        <div class="wish-responses">
          <div class="wish-card-head">
            <p class="wish-responses-label">{{ t("wish.myReply") }}</p>
            <p v-if="item.verdict !== 'passed'" class="information-status">{{ t(statusKey(item.verdict)) }}</p>
          </div>
          <p class="bounty-reply-meta">
            <span>{{ t("wish.replyPrice", { n: item.price || 0 }) }}</span>
            <span v-if="when(item.createdAt)"> · {{ when(item.createdAt) }}</span>
          </p>
          <p v-if="item.verdict === 'rejected' && item.rejectReason" class="wish-reason">{{ item.rejectReason }}</p>
          <p v-if="item.body" class="bounty-reply-body">{{ item.body }}</p>
          <img v-if="item.previewUrl" :src="item.previewUrl" alt="" class="information-preview" />
          <ul v-if="item.fileNames.length" class="wish-files">
            <li v-for="(name, index) in item.fileNames" :key="`${name}-${index}`" class="wish-file">
              <PaperclipIcon class="wish-file-icon" aria-hidden="true" />
              <span>{{ name }}</span>
            </li>
          </ul>
          <VideoFrame v-if="item.videos?.[0]" :url="item.videos[0].url" :poster="item.videos[0].poster || ''" />
        </div>
      </article>
    </div>
  </div>
</template>
