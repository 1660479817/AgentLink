<script setup>
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import AppButton from "../components/AppButton.vue";
import MentionPicker from "../components/MentionPicker.vue";
import PacketMediaFields from "../components/PacketMediaFields.vue";
import VideoFrame from "../components/VideoFrame.vue";
import WishCopy from "../components/WishCopy.vue";
import {
  createIntel,
  downloadInformation,
  listLooks,
  listMyResponses,
  listRequestResponses,
  listRequests,
  listSubmissions,
  lookRequest,
  uploadAttachment,
  uploadAudio,
  uploadImage,
} from "../api.js";
import { ATTACHMENT_ACCEPT, errorText, readOptionalPrice, readVideoLink, requireSession, usePacketMedia } from "../composers/packet.js";
import { acceptDownload } from "../download/consent.js";
import { payeeOf, priceOf } from "../record.js";
import { t } from "../i18n/index.js";
import StatusIcon from "../components/StatusIcon.vue";
import { AtIcon, AudioIcon, ChatIcon, ImageIcon, PaperclipIcon, RespondIcon, SendIcon, VideoIcon } from "../icons/index.js";
import { useSessionStore } from "../stores/session";

const session = useSessionStore();
const route = useRoute();
const router = useRouter();
const wishes = ref([]);
const openRequests = ref([]);
const looks = ref([]);
const replies = ref([]);
const lane = ref("posted");
const loaded = ref(false);
const busy = ref(false);
const fields = ref(null);
const imageInput = ref(null);
const fileInput = ref(null);
const audioInput = ref(null);
const replyImageInput = ref(null);
const replyFileInput = ref(null);
const replyAudioInput = ref(null);
const replyError = ref("");
const body = ref("");
const mentions = ref([]);
const mentionOpen = ref(false);
const replyBody = ref("");
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
const {
  images: replyImages,
  previewUrls: replyPreviewUrls,
  files: replyFiles,
  audio: replyAudio,
  video: replyVideo,
  videoOpen: replyVideoOpen,
  price: replyPrice,
  hasUpload: replyHasUpload,
  addImages: addReplyImages,
  removeImage: removeReplyImage,
  addFiles: addReplyFiles,
  removeFile: removeReplyFile,
  setAudio: setReplyAudio,
  removeAudio: removeReplyAudio,
  reset: resetReply,
} = usePacketMedia();

const canSend = () =>
  Boolean(body.value.trim() || video.value.trim() || images.value.length || files.value.length || audio.value);
const canReply = () =>
  Boolean(replyBody.value.trim() || replyVideo.value.trim() || replyImages.value.length || replyFiles.value.length || replyAudio.value);
const respondId = computed(() => String(route.query.respond || ""));
const target = computed(() => openRequests.value.find((item) => item.id === respondId.value && !item.mine) || null);
const targetMissing = computed(
  () => Boolean(respondId.value) && loaded.value && !openRequests.value.some((item) => item.id === respondId.value)
);
const engagements = computed(() => {
  const byId = new Map();
  for (const look of looks.value) {
    const wish = look.wish;
    if (!wish?.id) continue;
    byId.set(wish.id, { wish, lookedAt: look.lookedAt || "", responses: [] });
  }
  if (target.value && !byId.has(target.value.id)) {
    byId.set(target.value.id, { wish: target.value, lookedAt: "", responses: [] });
  }
  for (const reply of replies.value) {
    const id = reply.wish?.id;
    if (!id) continue;
    const row = byId.get(id) || { wish: reply.wish, lookedAt: reply.kMeta?.createdAt || "", responses: [] };
    row.responses.push(reply);
    if (!row.wish) row.wish = reply.wish;
    byId.set(id, row);
  }
  return [...byId.values()].sort((a, b) => String(b.lookedAt).localeCompare(String(a.lookedAt)));
});
const orphanReplies = computed(() => replies.value.filter((item) => !item.wish));

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
  return [...(item.images || []), ...(item.audio || []), ...(item.attachments || [])]
    .map((file) => file?.name || file?.url)
    .filter(Boolean);
}

async function load() {
  let open = [];
  try {
    const listed = await listRequests();
    open = listed.requests || [];
  } catch {
    open = [];
  }
  openRequests.value = open;
  const asked = String(route.query.respond || "");
  const found = open.find((item) => item.id === asked);
  if (asked && found?.mine) {
    await router.replace({ name: "wish", query: { wish: asked } });
  }
  if (!session.user) {
    wishes.value = [];
    looks.value = [];
    replies.value = [];
    loaded.value = true;
    return;
  }
  try {
    const [submitted, authored, looked] = await Promise.all([
      listSubmissions().catch(() => ({ submissions: [] })),
      listMyResponses().catch(() => ({ responses: [] })),
      listLooks().catch(() => ({ looks: [] })),
    ]);
    const byId = new Map();
    for (const item of submitted.submissions || []) {
      if (item.kMeta?.kind !== "wish") continue;
      byId.set(item.id, {
        ...item,
        responses: [],
      });
    }
    for (const item of open) {
      if (!item.mine) continue;
      const existing = byId.get(item.id);
      byId.set(item.id, {
        ...item,
        kMeta: { ...(item.kMeta || {}), verdict: existing?.kMeta?.verdict || item.kMeta?.verdict || "passed" },
        responses: [],
      });
    }
    const rows = [...byId.values()].sort((a, b) => String(b.kMeta?.createdAt).localeCompare(String(a.kMeta?.createdAt)));
    await Promise.all(
      rows
        .filter((item) => item.kMeta?.verdict === "passed")
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
    looks.value = looked.looks || [];
    replies.value = authored.responses || [];
  } catch {
    wishes.value = [];
    looks.value = [];
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

function hasStored(item) {
  return [...(item?.images || []), ...(item?.audio || []), ...(item?.attachments || [])].some((file) => file?.stored);
}

function downloadStage(item) {
  if (!hasStored(item)) return "none";
  return item?.granted ? "done" : "open";
}

async function ensureLook() {
  const id = respondId.value;
  if (!id || !session.user) return;
  const found = openRequests.value.find((item) => item.id === id);
  if (found?.mine) {
    await router.replace({ name: "wish", query: { wish: id } });
    return;
  }
  if (!found) return;
  try {
    await lookRequest(id);
    const data = await listLooks();
    looks.value = data.looks || looks.value;
  } catch (err) {
    if (err.code === "bad_state") await router.replace({ name: "wish", query: { wish: id } });
  }
}

function openLook(id) {
  router.push({ name: "wish", query: { respond: id } });
}

async function showLook(id) {
  if (!id) return;
  lane.value = "replied";
  await nextTick();
  document.getElementById(`wish-look-${id}`)?.scrollIntoView({ block: "start" });
  document.getElementById("wish-reply-body")?.focus();
}

onMounted(async () => {
  if (respondId.value) lane.value = "replied";
  await load();
  if (respondId.value) await ensureLook();
  if (respondId.value) await showLook(respondId.value);
  else await focusWish();
});
watch(() => route.query.wish, focusWish);
watch(respondId, async (id, prev) => {
  if (!id || id === prev) return;
  replyBody.value = "";
  resetReply();
  replyError.value = "";
  await ensureLook();
  if (respondId.value) await showLook(respondId.value);
});

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

function pickReplyImages(event) {
  addReplyImages(Array.from(event.target.files || []));
  event.target.value = "";
}

function pickReplyFiles(event) {
  addReplyFiles(Array.from(event.target.files || []));
  event.target.value = "";
}

function pickReplyAudio(event) {
  const file = Array.from(event.target.files || [])[0];
  event.target.value = "";
  if (file) setReplyAudio(file);
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
    const extra = { kind: "wish" };
    if (audio.value) {
      const uploaded = await uploadAudio(audio.value.file);
      extra.audioIds = [uploaded.id];
    }
    if (link) extra.videos = [link];
    if (mentions.value.length) extra.mentions = mentions.value.map((friend) => friend.id);
    await createIntel(body.value.trim(), imageIds, fileIds, extra);
    body.value = "";
    mentions.value = [];
    mentionOpen.value = false;
    agreed.value = false;
    resetMedia();
    await load();
  } catch (err) {
    error.value = errorText(err.code, session.policy);
  } finally {
    busy.value = false;
  }
}

async function submitReply() {
  if (!target.value || !canReply() || busy.value) return;
  replyError.value = "";
  const link = readVideoLink(replyVideo.value);
  if (link === null) {
    replyError.value = t("home.badVideo");
    return;
  }
  const priced = replyHasUpload.value ? readOptionalPrice(replyPrice.value, session.policy) : { ok: true, price: undefined };
  if (!priced.ok) {
    replyError.value = errorText("bad_price", session.policy);
    return;
  }
  const respondsTo = target.value.id;
  busy.value = true;
  try {
    requireSession(session.user);
    const imageIds = [];
    for (const file of replyImages.value) {
      const data = await uploadImage(file);
      imageIds.push(data.id);
    }
    const fileIds = [];
    for (const item of replyFiles.value) {
      const uploaded = await uploadAttachment(item.file);
      fileIds.push(uploaded.id);
    }
    const extra = { kind: "wishRespond", respondsTo };
    if (replyAudio.value) {
      const uploaded = await uploadAudio(replyAudio.value.file);
      extra.audioIds = [uploaded.id];
    }
    if (link) extra.videos = [link];
    if (priced.price !== undefined) extra.price = priced.price;
    await createIntel(replyBody.value.trim(), imageIds, fileIds, extra);
    replyBody.value = "";
    resetReply();
    lane.value = "replied";
    await load();
  } catch (err) {
    replyError.value = errorText(err.code, session.policy);
  } finally {
    busy.value = false;
  }
}

async function downloadWish(wish) {
  if (!wish || wish.downloading) return;
  wish.downloading = true;
  try {
    const ok = await acceptDownload({
      price: priceOf(wish),
      payee: payeeOf(wish),
      granted: Boolean(wish.granted),
      code: session.user ? "" : "no_session",
      task: () => downloadInformation(wish.id),
    });
    if (!ok) return;
    try {
      await load();
      if (session.user) await session.load();
    } catch {
      wish.granted = true;
    }
  } finally {
    wish.downloading = false;
  }
}

async function downloadReply(item) {
  if (item.downloading) return;
  item.downloading = true;
  try {
    const ok = await acceptDownload({
      price: priceOf(item),
      payee: payeeOf(item),
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
      <MentionPicker v-model="mentions" v-model:body="body" v-model:open="mentionOpen" :disabled="busy" />
      <div class="share-actions">
        <button
          type="button"
          class="share-action"
          :disabled="busy"
          :aria-expanded="mentionOpen"
          :aria-label="t('home.mention')"
          @click="mentionOpen = !mentionOpen"
        >
          <AtIcon class="share-action-icon share-action-mention" aria-hidden="true" />
          <span>{{ t("home.mention") }}</span>
        </button>
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
      <input ref="fileInput" type="file" :accept="ATTACHMENT_ACCEPT" multiple class="visually-hidden" @change="pickFiles" />
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
        :aria-label="t('wish.posted')"
        @click="selectLane('posted')"
      >
        <SendIcon class="wish-lane-icon" aria-hidden="true" />
      </button>
      <button
        id="wish-tab-replied"
        type="button"
        class="wish-lane"
        role="tab"
        :class="{ 'is-active': lane === 'replied' }"
        :aria-selected="lane === 'replied'"
        aria-controls="wish-panel-replied"
        :aria-label="t('wish.replied')"
        @click="selectLane('replied')"
      >
        <RespondIcon class="wish-lane-icon" aria-hidden="true" />
      </button>
    </div>

    <div v-if="lane === 'posted'" id="wish-panel-posted" role="tabpanel" aria-labelledby="wish-tab-posted">
    <section v-if="loaded && !session.user" class="card wish-empty">
      <p>{{ t("wish.login") }}</p>
      <AppButton variant="secondary" to="/">{{ t("wish.loginAction") }}</AppButton>
    </section>
    <section v-else-if="loaded && wishes.length === 0" class="card wish-empty">
      <p class="empty-line">
        <ChatIcon class="empty-icon" aria-hidden="true" />
        <span>{{ t("wish.empty") }}</span>
      </p>
    </section>

    <article
      v-for="wish in wishes"
      :id="`wish-${wish.id}`"
      :key="wish.id"
      class="card post wish-card"
      :class="{ 'is-current': String(route.query.wish || '') === wish.id }"
    >
      <div class="wish-card-head">
        <p v-if="wish.kMeta?.verdict !== 'passed'" class="information-status">
          <StatusIcon :verdict="wish.kMeta?.verdict || 'pending'" />
          {{ t(statusKey(wish.kMeta?.verdict)) }}
        </p>
        <p v-if="when(wish.kMeta?.createdAt)" class="information-time">{{ when(wish.kMeta.createdAt) }}</p>
      </div>
      <p v-if="wish.kMeta?.verdict === 'rejected' && wish.kMeta?.rejectReason" class="wish-reason">{{ wish.kMeta.rejectReason }}</p>
      <WishCopy v-if="wish.body" :body="wish.body" />
      <img v-if="wish.previewUrl" :src="wish.previewUrl" alt="" class="information-preview" />
      <ul v-if="namesOf(wish).length" class="wish-files">
        <li v-for="(name, index) in namesOf(wish)" :key="`${name}-${index}`" class="wish-file">
          <PaperclipIcon class="wish-file-icon" aria-hidden="true" />
          <span>{{ name }}</span>
        </li>
      </ul>
      <VideoFrame v-if="wish.videos?.[0]" :url="wish.videos[0].url" :poster="wish.videos[0].poster || ''" />
      <div class="wish-responses">
        <p class="wish-responses-label">{{ t("wish.responses") }}</p>
        <p v-if="wish.kMeta?.verdict === 'passed' && !wish.responses.length" class="muted">{{ t("wish.responsesEmpty") }}</p>
        <p v-else-if="wish.kMeta?.verdict !== 'passed'" class="muted">{{ t("wish.responsesWait") }}</p>
        <div v-for="item in wish.responses" :key="item.id" class="wish-response">
          <p class="bounty-reply-meta">
            <span>{{ item.author?.name || t("home.author") }}</span>
            <span v-if="when(item.kMeta?.createdAt)"> · {{ when(item.kMeta.createdAt) }}</span>
          </p>
          <p v-if="item.body" class="bounty-reply-body">{{ item.body }}</p>
          <img v-if="item.previewUrl" :src="item.previewUrl" alt="" class="information-preview" />
          <ul v-if="namesOf(item).length" class="wish-files">
            <li v-for="(name, index) in namesOf(item)" :key="`${name}-${index}`" class="wish-file">
              <PaperclipIcon class="wish-file-icon" aria-hidden="true" />
              <span>{{ name }}</span>
            </li>
          </ul>
          <VideoFrame v-if="item.videos?.[0]" :url="item.videos[0].url" :poster="item.videos[0].poster || ''" />
          <AppButton
            v-if="namesOf(item).length"
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
      <section v-if="loaded && !session.user && !target" class="card wish-empty">
        <p>{{ t("wish.login") }}</p>
        <AppButton variant="secondary" to="/">{{ t("wish.loginAction") }}</AppButton>
      </section>
      <section v-else-if="targetMissing" class="card wish-empty">
        <p>{{ t("wish.replyMissing") }}</p>
      </section>
      <section v-else-if="loaded && !engagements.length && !orphanReplies.length" class="card wish-empty">
        <p class="empty-line">
          <ChatIcon class="empty-icon" aria-hidden="true" />
          <span>{{ t("wish.repliedEmpty") }}</span>
        </p>
      </section>

      <article
        v-for="item in engagements"
        :id="`wish-look-${item.wish.id}`"
        :key="item.wish.id"
        class="card post wish-card"
        :class="{ 'is-current': respondId === item.wish.id }"
      >
        <div class="wish-target">
          <WishCopy v-if="item.wish.body" :body="item.wish.body" />
          <img v-if="item.wish.previewUrl" :src="item.wish.previewUrl" alt="" class="information-preview" />
          <ul v-if="namesOf(item.wish).length" class="wish-files">
            <li v-for="(name, index) in namesOf(item.wish)" :key="`${name}-${index}`" class="wish-file">
              <PaperclipIcon class="wish-file-icon" aria-hidden="true" />
              <span>{{ name }}</span>
            </li>
          </ul>
          <VideoFrame v-if="item.wish.videos?.[0]" :url="item.wish.videos[0].url" :poster="item.wish.videos[0].poster || ''" />
        </div>
        <ol class="wish-stages">
          <li class="wish-stage is-done">
            <span class="wish-stage-index" aria-hidden="true">1</span>
            <p class="wish-stage-label">{{ t("wish.stageLookDone") }}</p>
          </li>
          <li class="wish-stage" :class="{ 'is-done': downloadStage(item.wish) !== 'open' }">
            <span class="wish-stage-index" aria-hidden="true">2</span>
            <div class="wish-stage-body">
              <p class="wish-stage-label">
                {{
                  downloadStage(item.wish) === "none"
                    ? t("wish.stageNoDownload")
                    : downloadStage(item.wish) === "done"
                      ? t("wish.stageDownloaded")
                      : t("wish.stageDownload")
                }}
              </p>
              <AppButton
                v-if="downloadStage(item.wish) !== 'none' && session.user"
                variant="secondary"
                type="button"
                :disabled="item.wish.downloading"
                @click="downloadWish(item.wish)"
              >
                {{ t("wish.download") }}
              </AppButton>
            </div>
          </li>
          <li class="wish-stage" :class="{ 'is-done': item.responses.length }">
            <span class="wish-stage-index" aria-hidden="true">3</span>
            <div class="wish-stage-body">
              <p class="wish-stage-label">{{ item.responses.length ? t("wish.stageReplied") : t("wish.stageReply") }}</p>
              <div v-for="reply in item.responses" :key="reply.id" class="wish-response">
                <div class="wish-card-head">
                  <p class="wish-responses-label">{{ t("wish.myReply") }}</p>
                  <p v-if="reply.kMeta?.verdict !== 'passed'" class="information-status">
                    <StatusIcon :verdict="reply.kMeta?.verdict || 'pending'" />
                    {{ t(statusKey(reply.kMeta?.verdict)) }}
                  </p>
                </div>
                <p class="bounty-reply-meta">
                  <span>{{ t("wish.replyPrice", { n: priceOf(reply) }) }}</span>
                  <span v-if="when(reply.kMeta?.createdAt)"> · {{ when(reply.kMeta.createdAt) }}</span>
                </p>
                <p v-if="reply.kMeta?.verdict === 'rejected' && reply.kMeta?.rejectReason" class="wish-reason">{{ reply.kMeta.rejectReason }}</p>
                <p v-if="reply.body" class="bounty-reply-body">{{ reply.body }}</p>
                <img v-if="reply.previewUrl" :src="reply.previewUrl" alt="" class="information-preview" />
                <ul v-if="namesOf(reply).length" class="wish-files">
                  <li v-for="(name, index) in namesOf(reply)" :key="`${name}-${index}`" class="wish-file">
                    <PaperclipIcon class="wish-file-icon" aria-hidden="true" />
                    <span>{{ name }}</span>
                  </li>
                </ul>
                <VideoFrame v-if="reply.videos?.[0]" :url="reply.videos[0].url" :poster="reply.videos[0].poster || ''" />
              </div>
              <template v-if="!item.responses.length && session.user && respondId === item.wish.id">
                <form id="wish-reply-form" class="share-dialog" @submit.prevent="submitReply">
                  <PacketMediaFields
                    v-model:body="replyBody"
                    v-model:video="replyVideo"
                    v-model:price="replyPrice"
                    body-id="wish-reply-body"
                    :body-label="t('wish.respondTitle')"
                    :placeholder="t('wish.respondPlaceholder')"
                    :rows="2"
                    grow
                    :video-open="replyVideoOpen"
                    :previews="replyPreviewUrls"
                    :audio-name="replyAudio?.name || ''"
                    :files="replyFiles"
                    :show-price="replyHasUpload"
                    :show-free-note="false"
                    price-id="wish-reply-price"
                    :busy="busy"
                    @remove-image="removeReplyImage"
                    @remove-audio="removeReplyAudio"
                    @remove-file="removeReplyFile"
                  />
                </form>
                <div class="share-actions">
                  <button type="button" class="share-action" :disabled="busy" @click="replyImageInput?.click()">
                    <ImageIcon class="share-action-icon share-action-image" aria-hidden="true" />
                    <span>{{ t("home.shareImage") }}</span>
                  </button>
                  <button type="button" class="share-action" :disabled="busy" @click="replyVideoOpen = true">
                    <VideoIcon class="share-action-icon share-action-video" aria-hidden="true" />
                    <span>{{ t("home.shareVideo") }}</span>
                  </button>
                  <button type="button" class="share-action" :disabled="busy" @click="replyAudioInput?.click()">
                    <AudioIcon class="share-action-icon share-action-audio" aria-hidden="true" />
                    <span>{{ t("home.shareAudio") }}</span>
                  </button>
                  <button type="button" class="share-action" :disabled="busy" @click="replyFileInput?.click()">
                    <PaperclipIcon class="share-action-icon share-action-file" aria-hidden="true" />
                    <span>{{ t("home.shareFile") }}</span>
                  </button>
                </div>
                <div class="wish-submit-row">
                  <p class="wish-respond-hint">{{ t("wish.respondHint") }}</p>
                  <AppButton
                    class="wish-send"
                    variant="icon"
                    type="submit"
                    form="wish-reply-form"
                    :aria-label="t('wish.respondSend')"
                    :disabled="busy || !canReply()"
                  >
                    <SendIcon aria-hidden="true" />
                  </AppButton>
                </div>
                <p v-if="replyError" class="error" role="alert">{{ replyError }}</p>
              </template>
              <AppButton
                v-else-if="!item.responses.length && session.user"
                variant="secondary"
                type="button"
                @click="openLook(item.wish.id)"
              >
                {{ t("wish.stageReplyAction") }}
              </AppButton>
            </div>
          </li>
        </ol>
        <div v-if="!session.user" class="wish-empty">
          <p>{{ t("wish.respondLogin") }}</p>
          <AppButton variant="secondary" to="/">{{ t("wish.loginAction") }}</AppButton>
        </div>
      </article>

      <article v-for="item in orphanReplies" :key="item.id" class="card post wish-card">
        <div class="wish-target">
          <p class="muted">{{ t("wish.replyMissing") }}</p>
        </div>
        <div class="wish-responses">
          <div class="wish-card-head">
            <p class="wish-responses-label">{{ t("wish.myReply") }}</p>
            <p v-if="item.kMeta?.verdict !== 'passed'" class="information-status">
              <StatusIcon :verdict="item.kMeta?.verdict || 'pending'" />
              {{ t(statusKey(item.kMeta?.verdict)) }}
            </p>
          </div>
          <p v-if="item.body" class="bounty-reply-body">{{ item.body }}</p>
        </div>
      </article>
      <input ref="replyImageInput" type="file" accept="image/*" multiple class="visually-hidden" @change="pickReplyImages" />
      <input ref="replyFileInput" type="file" :accept="ATTACHMENT_ACCEPT" multiple class="visually-hidden" @change="pickReplyFiles" />
      <input ref="replyAudioInput" type="file" accept="audio/*" class="visually-hidden" @change="pickReplyAudio" />
    </div>
  </div>
</template>
