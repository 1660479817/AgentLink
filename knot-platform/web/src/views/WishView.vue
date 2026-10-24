<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { toPlain } from "@knot/markdown";
import { useRoute, useRouter } from "vue-router";
import ActorMark from "../components/ActorMark.vue";
import AppButton from "../components/AppButton.vue";
import InformationCard from "../components/InformationCard.vue";
import MentionPicker from "../components/MentionPicker.vue";
import PacketMediaFields from "../components/PacketMediaFields.vue";
import VideoFrame from "../components/VideoFrame.vue";
import WishCopy from "../components/WishCopy.vue";
import WishRail from "../components/WishRail.vue";
import {
  addCardFriend,
  dismissInformation,
  downloadInformation,
  listInformation,
  listLooks,
  listMyResponses,
  listRequestResponses,
  listRequests,
  listSubmissions,
  lookRequest,
  removeCardFriend,
  starInformation,
  unstarInformation,
} from "../api.js";
import { ATTACHMENT_ACCEPT, errorText, readOptionalPrice, readVideoLink, requireSession, usePacketMedia } from "../composers/packet.js";
import { acceptDownload } from "../download/consent.js";
import { cardGranted, cardIsMine } from "../discoverBoard.js";
import { cardProps } from "../cardProps.js";
import { feeOf, priceOf, statusKey, wishIsLive } from "../record.js";
import { startPolling } from "../polling.js";
import { timeAgo } from "../time.js";
import { altLabel } from "../mediaLabel.js";
import { t } from "../i18n/index.js";
import RecordMedia from "../components/RecordMedia.vue";
import StatusIcon from "../components/StatusIcon.vue";
import { AtIcon, AudioIcon, ChatIcon, CoinIcon, ImageIcon, PaperclipIcon, PlusIcon, RespondIcon, SendIcon, UserIcon, VideoIcon } from "../icons/index.js";
import { packetDraft, useOutboxStore } from "../stores/outbox";
import { useSessionStore } from "../stores/session";

const session = useSessionStore();
const outbox = useOutboxStore();
const route = useRoute();
const router = useRouter();
const wishes = ref([]);
const openRequests = ref([]);
const looks = ref([]);
const replies = ref([]);
// 进页面先给出售这一栏：公开可逛，未登录也能看。带 ?wish= 或 ?respond= 时再切到对应栏。
const lane = ref("sales");
const loaded = ref(false);
// 我的列表取失败时单独记一笔，界面据此说「没连上」而不是「没有」。
const listFailed = ref(false);
// 「提交中」= 出站队列里还有任务。原来这里是 ref(false) 且从未置真，
// 于是 :disabled="busy" 与轮询的 when 条件全是常量，表单也没有提交互斥。
const busy = computed(() => outbox.jobs.length > 0);
const fields = ref(null);
const imageInput = ref(null);
const fileInput = ref(null);
const audioInput = ref(null);
const replyImageInput = ref(null);
const replyFileInput = ref(null);
const replyAudioInput = ref(null);
const posterInput = ref(null);
const replyPosterInput = ref(null);
const replyError = ref("");
const body = ref("");
const hours = ref(24);
const mentions = ref([]);
const mentionOpen = ref(false);
const replyBody = ref("");
const agreed = ref(false);
const composeOpen = ref(false);
let requestsPoll = null;
const sales = ref([]);
const salesCursor = ref(null);
const salesLoaded = ref(false);
const salesFailed = ref(false);
const salesMore = ref(false);
const salesLoading = ref(false);
const {
  images,
  previewUrls,
  files,
  audio,
  video,
  videoOpen,
  posterFile,
  posterPreview,
  price,
  error,
  addImages,
  removeImage,
  addFiles,
  removeFile,
  setAudio,
  removeAudio,
  setPosterFile,
  removePoster,
  reset: resetMedia,
} = usePacketMedia();
const {
  images: replyImages,
  previewUrls: replyPreviewUrls,
  files: replyFiles,
  audio: replyAudio,
  video: replyVideo,
  videoOpen: replyVideoOpen,
  posterFile: replyPosterFile,
  posterPreview: replyPosterPreview,
  price: replyPrice,
  addImages: addReplyImages,
  removeImage: removeReplyImage,
  addFiles: addReplyFiles,
  removeFile: removeReplyFile,
  setAudio: setReplyAudio,
  removeAudio: removeReplyAudio,
  setPosterFile: setReplyPosterFile,
  removePoster: removeReplyPoster,
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
  const now = Date.now();
  for (const look of looks.value) {
    const wish = look.wish;
    if (!wish?.id || !wishIsLive(wish, now)) continue;
    byId.set(wish.id, { wish, lookedAt: look.lookedAt || "", responses: [] });
  }
  if (target.value && wishIsLive(target.value, now) && !byId.has(target.value.id)) {
    byId.set(target.value.id, { wish: target.value, lookedAt: "", responses: [] });
  }
  for (const reply of replies.value) {
    const id = reply.wish?.id;
    if (!id || !wishIsLive(reply.wish, now)) continue;
    const row = byId.get(id) || { wish: reply.wish, lookedAt: reply.kMeta?.createdAt || "", responses: [] };
    row.responses.push(reply);
    if (!row.wish) row.wish = reply.wish;
    byId.set(id, row);
  }
  return [...byId.values()].sort((a, b) => String(b.lookedAt).localeCompare(String(a.lookedAt)));
});
const orphanReplies = computed(() => replies.value.filter((item) => !item.wish));
const composeMode = computed(() => (lane.value === "sales" ? "sale" : "wish"));

// 出售区：带附件（可下载、可标价）的 post/fastpost。公开可读，未登录也能逛。
async function loadSales(cursor = null) {
  try {
    const data = await listInformation(null, cursor, { sales: true });
    const incoming = Array.isArray(data.information) ? data.information : [];
    if (cursor) {
      const seen = new Set(sales.value.map((item) => item.id));
      sales.value = [...sales.value, ...incoming.filter((row) => row?.id && !seen.has(row.id))];
    } else {
      sales.value = incoming;
    }
    salesCursor.value = incoming.length ? incoming[incoming.length - 1].id : cursor;
    salesMore.value = incoming.length > 0;
    salesLoaded.value = true;
    salesFailed.value = false;
  } catch {
    // 取失败不是「还没有出售」：空态与失败态要分开画。
    salesLoaded.value = true;
    salesFailed.value = true;
  }
}

async function loadMoreSales() {
  if (salesLoading.value || !salesMore.value) return;
  salesLoading.value = true;
  await loadSales(salesCursor.value || null);
  salesLoading.value = false;
}

function fileRows(item) {
  const written = String(item?.kMeta?.note || "").trim();
  const pending = (item?.kMeta?.verdict || "pending") === "pending";
  const note = written || (pending ? t("home.filePrechecked") : "");
  const rows = [];
  for (const file of item?.attachments || []) {
    const name = file?.name || file?.url;
    if (name) rows.push({ name, note });
  }
  return rows;
}

async function load() {
  let open = [];
  try {
    const listed = await listRequests();
    open = (listed.requests || []).filter((item) => wishIsLive(item));
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
      if (item.kMeta?.kind !== "wish" || !wishIsLive(item)) continue;
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
    // 一个常发 wish 的账号可能有几十条待回应：全并发就是几十个跨境请求。
    // 这里按批取，最多四个在飞；失败的那条标成「取不到」，不画成「还没有」。
    const asking = rows.filter((item) => item.kMeta?.verdict === "passed" || item.kMeta?.verdict === "pending");
    for (let i = 0; i < asking.length; i += 4) {
      await Promise.all(
        asking.slice(i, i + 4).map(async (item) => {
          try {
            const data = await listRequestResponses(item.id);
            item.responses = data.responses || [];
            item.responsesUnknown = false;
          } catch {
            item.responses = [];
            item.responsesUnknown = true;
          }
        })
      );
    }
    wishes.value = rows;
    looks.value = (looked.looks || []).filter((look) => !look.wish || wishIsLive(look.wish));
    replies.value = authored.responses || [];
    listFailed.value = false;
  } catch {
    // 不清空已经画出来的内容：隧道抖一下不该表现成「你什么都没有」。
    listFailed.value = true;
  } finally {
    loaded.value = true;
  }
}

// 卡片条上的 wish 会到期，也会有人新发。只刷这一份，不动我的列表和正在写的回应。
async function refreshOpenRequests() {
  try {
    const listed = await listRequests();
    openRequests.value = (listed.requests || []).filter((item) => wishIsLive(item));
  } catch {
    /* 保持当前卡片条，下一轮再试 */
  }
}

async function focusWish() {
  const id = String(route.query.wish || "");
  if (!id) return;
  lane.value = "posted";
  await nextTick();
  document.getElementById(`wish-${id}`)?.scrollIntoView({ block: "start" });
}

// 「写一个」打开发布表单，并把人放到输入框里。
async function openCompose() {
  composeOpen.value = true;
  await nextTick();
  document.querySelector(".wish-compose")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  document.getElementById("wish-body")?.focus({ preventScroll: true });
}

// 出售栏卡片上的作者、分类、话题都要能点：emit 有了没人接就是死按钮。
function filterByAuthor(item) {
  const id = item?.author?.id;
  if (!id) return;
  router.push({ name: "discover", query: { author: id } });
}

function filterByCategory(item) {
  const category = String(item?.kMeta?.category || "").trim();
  if (!category) return;
  router.push({ name: "discover", query: { category } });
}

function filterByTopic(topic) {
  const value = String(topic || "").trim();
  if (!value) return;
  router.push({ name: "discover", query: { topic: value } });
}

const LANES = ["sales", "posted", "replied"];

function selectLane(next) {
  lane.value = next;
}

// 三栏是一组 tab：只有当前栏在 Tab 序列里（roving tabindex），
// 左右/上下键在栏间移动，Home/End 到首尾，这是 tablist 的键盘约定。
function onLaneKey(event, index) {
  let next = index;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % LANES.length;
  else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index + LANES.length - 1) % LANES.length;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = LANES.length - 1;
  else return;
  event.preventDefault();
  selectLane(LANES[next]);
  document.getElementById(`wish-tab-${LANES[next]}`)?.focus();
}

function hasStored(item) {
  return (item?.attachments || []).some((file) => file?.stored);
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
  loadSales();
  requestsPoll = startPolling({
    fn: refreshOpenRequests,
    intervalMs: 60 * 1000,
    when: () => !busy.value,
  });
  if (respondId.value) await ensureLook();
  if (respondId.value) await showLook(respondId.value);
  else await focusWish();
});
onBeforeUnmount(() => {
  requestsPoll?.stop();
  requestsPoll = null;
});
watch(() => route.query.wish, focusWish);
watch(
  () => outbox.revision,
  (revision) => {
    if (revision) load();
    if (revision) loadSales();
  }
);
// 回应草稿按 wish id 分开存：在左栏点到另一条 wish 时，不能把已经写好的正文和附件冲掉。
// 附件是 File 对象，预览 URL 在 reset 时被回收，所以放回草稿要重新走 add*/set* 的校验入口。
const replyDrafts = new Map();

function stashReplyDraft(id) {
  if (!id) return;
  if (!canReply()) {
    replyDrafts.delete(id);
    return;
  }
  replyDrafts.set(id, {
    body: replyBody.value,
    price: replyPrice.value,
    video: replyVideo.value,
    images: [...replyImages.value],
    files: [...replyFiles.value],
    audio: replyAudio.value,
    posterFile: replyPosterFile.value,
  });
}

async function restoreReplyDraft(id) {
  const draft = replyDrafts.get(id);
  if (!draft) return;
  replyBody.value = draft.body;
  replyPrice.value = draft.price;
  replyVideo.value = draft.video;
  if (draft.images.length) await addReplyImages(draft.images);
  if (draft.files.length) addReplyFiles(draft.files.map((item) => item.file));
  if (draft.audio?.file) setReplyAudio(draft.audio.file);
  if (draft.posterFile) setReplyPosterFile(draft.posterFile);
}

watch(respondId, async (id, prev) => {
  if (id === prev) return;
  if (prev) stashReplyDraft(prev);
  replyBody.value = "";
  resetReply();
  replyError.value = "";
  if (!id) return;
  await restoreReplyDraft(id);
  await ensureLook();
  if (respondId.value) await showLook(respondId.value);
});

async function pickImages(event) {
  await addImages(Array.from(event.target.files || []));
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

async function pickReplyImages(event) {
  await addReplyImages(Array.from(event.target.files || []));
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

async function pickPoster(event) {
  const file = Array.from(event.target.files || [])[0];
  event.target.value = "";
  if (file) await setPosterFile(file);
}

async function pickReplyPoster(event) {
  const file = Array.from(event.target.files || [])[0];
  event.target.value = "";
  if (file) await setReplyPosterFile(file);
}

function submit() {
  if (!canSend() || busy.value) return;
  if (composeMode.value === "wish" && !agreed.value) return;
  error.value = "";
  const link = readVideoLink(video.value);
  if (link === null) {
    error.value = t("home.badVideo");
    return;
  }
  let videoPayload = null;
  if (link) {
    if (!posterFile.value) {
      error.value = t("home.badPoster");
      return;
    }
    videoPayload = { url: link, posterFile: posterFile.value };
  }
  try {
    requireSession(session.user);
  } catch (err) {
    error.value = errorText(err.code, session.policy);
    return;
  }
  let extra;
  if (composeMode.value === "sale") {
    const priced = files.value.length ? readOptionalPrice(price.value, session.policy) : { ok: true, price: undefined };
    if (files.value.length && !priced.ok) {
      error.value = errorText("bad_price", session.policy);
      return;
    }
    extra = { kind: "post", public: true };
    if (files.value.length && priced.price !== undefined) extra.price = priced.price;
  } else {
    const lifespan = Number(hours.value);
    if (!Number.isInteger(lifespan) || lifespan < 1 || lifespan > 24) {
      error.value = t("wish.badHours");
      return;
    }
    extra = { kind: "wish", hours: lifespan };
  }
  if (mentions.value.length) extra.mentions = mentions.value.map((friend) => friend.id);
  outbox.enqueue(packetDraft({
    body: body.value.trim(),
    images: images.value,
    files: files.value.map((item) => item.file),
    audio: audio.value?.file || null,
    video: videoPayload,
    extra,
    policy: session.policy,
  }));
  body.value = "";
  mentions.value = [];
  mentionOpen.value = false;
  agreed.value = false;
  resetMedia();
  composeOpen.value = false;
}

async function submitReply() {
  if (!target.value) {
    // 轮询里这条 wish 可能已经过期或被关掉：不能静默什么都不做。
    replyError.value = t("wish.replyMissing");
    return;
  }
  if (!canReply() || busy.value) return;
  replyError.value = "";
  const link = readVideoLink(replyVideo.value);
  if (link === null) {
    replyError.value = t("home.badVideo");
    return;
  }
  let replyVideoPayload = null;
  if (link) {
    if (!replyPosterFile.value) {
      replyError.value = t("home.badPoster");
      return;
    }
    replyVideoPayload = { url: link, posterFile: replyPosterFile.value };
  }
  const priced = replyFiles.value.length ? readOptionalPrice(replyPrice.value, session.policy) : { ok: true, price: undefined };
  if (replyFiles.value.length && !priced.ok) {
    replyError.value = errorText("bad_price", session.policy);
    return;
  }
  try {
    requireSession(session.user);
  } catch (err) {
    replyError.value = errorText(err.code, session.policy);
    return;
  }
  const extra = { kind: "wishRespond", respondsTo: target.value.id };
  if (priced.price !== undefined) extra.price = priced.price;
  outbox.enqueue(packetDraft({
    body: replyBody.value.trim(),
    images: replyImages.value,
    files: replyFiles.value.map((item) => item.file),
    audio: replyAudio.value?.file || null,
    video: replyVideoPayload,
    extra,
    policy: session.policy,
  }));
  replyBody.value = "";
  resetReply();
  // 发出去了，这条 wish 的草稿就不该再留着。
  replyDrafts.delete(target.value.id);
  lane.value = "replied";
}

async function downloadWish(wish) {
  if (!wish || wish.downloading) return;
  wish.downloading = true;
  try {
    if (session.user) await session.load();
    const ok = await acceptDownload({
      price: priceOf(wish),
      fee: feeOf(wish),
      // 与卡片同一套判定，不再用另一个字段名反推。
      granted: cardGranted(wish, session.user),
      mine: cardIsMine(wish, session.user),
      balance: session.user?.pointsBalance,
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
    if (session.user) await session.load();
    const ok = await acceptDownload({
      price: priceOf(item),
      fee: feeOf(item),
      granted: cardGranted(item, session.user),
      mine: false,
      balance: session.user?.pointsBalance,
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

async function downloadSale(item) {
  if (item.downloading) return;
  item.downloading = true;
  try {
    if (session.user) await session.load();
    const ok = await acceptDownload({
      price: priceOf(item),
      fee: feeOf(item),
      granted: cardGranted(item, session.user),
      mine: cardIsMine(item, session.user),
      balance: session.user?.pointsBalance,
      code: session.user ? "" : "no_session",
      task: () => downloadInformation(item.id),
    });
    if (!ok) return;
    try {
      const data = await listInformation(null, null, { sales: true });
      const next = (data.information || []).find((row) => row.id === item.id);
      if (next) Object.assign(item, next);
      else item.granted = true;
      if (session.user) await session.load();
    } catch {
      item.granted = true;
    }
  } finally {
    item.downloading = false;
  }
}

async function toggleSaleStar(item) {
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

async function toggleSaleFriend(item) {
  if (!session.user || !item.canFriend) return;
  const previous = Boolean(item.friend);
  item.friend = !previous;
  try {
    const data = item.friend ? await addCardFriend(item.id) : await removeCardFriend(item.id);
    item.friend = Boolean(data.friend);
  } catch {
    item.friend = previous;
  }
}

async function dismissSale(item) {
  const previous = sales.value;
  sales.value = sales.value.filter((row) => row.id !== item.id);
  try {
    await dismissInformation(item.id);
  } catch {
    // 请求失败就放回去，包括 401：服务端没删，界面不能先把这条吞掉。
    // 会话过期由路由自己把人送回登录页，不靠这里少画一行来表达。
    sales.value = previous;
  }
}
</script>

<template>
  <div class="wish-page">
    <h1 class="page-title">{{ t("wish.title") }}</h1>
    <p class="wish-lead">{{ t("wish.lead") }}</p>

    <WishRail :wishes="openRequests" :label="t('wish.railLabel')" />

    <div class="card wish-lanes" role="tablist" :aria-label="t('wish.lanes')">
      <button
        id="wish-tab-sales"
        type="button"
        class="wish-lane"
        role="tab"
        :class="{ 'is-active': lane === 'sales' }"
        :aria-selected="lane === 'sales'"
        :tabindex="lane === 'sales' ? 0 : -1"
        aria-controls="wish-panel-sales"
        :aria-label="t('wish.salesTab')"
        @click="selectLane('sales')"
        @keydown="onLaneKey($event, 0)"
      >
        <CoinIcon class="wish-lane-icon" aria-hidden="true" />
      </button>
      <button
        id="wish-tab-posted"
        type="button"
        class="wish-lane"
        role="tab"
        :class="{ 'is-active': lane === 'posted' }"
        :aria-selected="lane === 'posted'"
        :tabindex="lane === 'posted' ? 0 : -1"
        aria-controls="wish-panel-posted"
        :aria-label="t('wish.posted')"
        @click="selectLane('posted')"
        @keydown="onLaneKey($event, 1)"
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
        :tabindex="lane === 'replied' ? 0 : -1"
        aria-controls="wish-panel-replied"
        :aria-label="t('wish.replied')"
        @click="selectLane('replied')"
        @keydown="onLaneKey($event, 2)"
      >
        <RespondIcon class="wish-lane-icon" aria-hidden="true" />
      </button>
    </div>

    <div v-if="lane === 'sales'" id="wish-panel-sales" role="tabpanel" aria-labelledby="wish-tab-sales">
      <section v-if="salesFailed" class="card wish-empty">
        <p class="error" role="alert">{{ t("error.request_failed") }}</p>
        <AppButton variant="secondary" @click="loadSales()">{{ t("gate.retry") }}</AppButton>
      </section>
      <section v-else-if="salesLoaded && sales.length === 0" class="card wish-empty">
        <p class="empty-line">
          <CoinIcon class="empty-icon" aria-hidden="true" />
          <span>{{ t("wish.saleEmpty") }}</span>
        </p>
      </section>

      <InformationCard
        v-for="item in sales"
        :id="`sale-${item.id}`"
        :key="item.id"
        v-bind="cardProps(item, { session })"
        @author="filterByAuthor(item)"
        @category="filterByCategory(item)"
        @topic="filterByTopic"
        @dismiss="dismissSale(item)"
        @star="toggleSaleStar(item)"
        @friend="toggleSaleFriend(item)"
        @download="downloadSale(item)"
      />

      <div v-if="salesLoaded" class="feed-more">
        <AppButton
          v-if="salesMore"
          variant="secondary"
          :disabled="salesLoading"
          @click="loadMoreSales"
        >
          {{ salesLoading ? t("home.loadingMore") : t("home.loadMore") }}
        </AppButton>
        <p v-else class="muted feed-end-note">{{ t("home.noMore") }}</p>
      </div>
    </div>

    <div v-if="lane === 'posted'" id="wish-panel-posted" role="tabpanel" aria-labelledby="wish-tab-posted">
    <section v-if="loaded && !session.user" class="card wish-empty">
      <p>{{ t("wish.login") }}</p>
      <AppButton variant="secondary" to="/">{{ t("wish.loginAction") }}</AppButton>
    </section>
    <p v-if="listFailed" class="error" role="alert">{{ t("error.request_failed") }}</p>
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
        <ActorMark :actor="wish.actor" />
        <p v-if="wish.kMeta?.verdict !== 'passed'" class="information-status">
          <StatusIcon :verdict="wish.kMeta?.verdict || 'pending'" />
          {{ t(statusKey(wish.kMeta?.verdict)) }}
        </p>
        <p v-if="timeAgo(wish.kMeta?.createdAt) || wish.kMeta?.language" class="information-time">
          <span v-if="timeAgo(wish.kMeta?.createdAt)">{{ timeAgo(wish.kMeta.createdAt) }}</span>
          <span v-if="timeAgo(wish.kMeta?.createdAt) && wish.kMeta?.language"> · </span>
          <span v-if="wish.kMeta?.language">{{ wish.kMeta.language }}</span>
        </p>
      </div>
      <p v-if="wish.kMeta?.verdict === 'rejected' && wish.kMeta?.rejectReason" class="wish-reason">{{ wish.kMeta.rejectReason }}</p>
      <WishCopy v-if="wish.body" :body="wish.body" />
      <RecordMedia :images="wish.images" :audio="wish.audio" :label="altLabel(wish.body)" />
      <ul v-if="fileRows(wish).length" class="wish-files">
        <li v-for="(file, index) in fileRows(wish)" :key="`${file.name}-${index}`" class="wish-file">
          <PaperclipIcon class="wish-file-icon" aria-hidden="true" />
          <span class="information-file-copy">
            <span class="information-file-name">{{ file.name }}</span><span v-if="file.note" class="information-file-note">{{ t("home.fileNoteJoin", { note: file.note }) }}</span>
          </span>
        </li>
      </ul>
      <VideoFrame v-if="wish.videos?.[0]" :url="wish.videos[0].url" :poster="wish.videos[0].poster || ''" :play-url="wish.videos[0].playUrl || ''" :label="altLabel(wish.body)" />
      <div class="wish-responses">
        <p class="wish-responses-label">{{ t("wish.responses") }}</p>
        <p v-if="wish.responsesUnknown" class="muted">{{ t("wish.responsesUnknown") }}</p>
        <p v-else-if="(wish.kMeta?.verdict === 'passed' || wish.kMeta?.verdict === 'pending') && !wish.responses.length" class="muted">{{ t("wish.responsesEmpty") }}</p>
        <p v-else-if="wish.kMeta?.verdict === 'rejected' || wish.kMeta?.verdict === 'removed'" class="muted">{{ t("wish.responsesWait") }}</p>
        <div v-for="item in wish.responses" :key="item.id" class="wish-response">
          <p class="bounty-reply-meta">
            <ActorMark :actor="item.actor" />
            <span>{{ item.author?.name || t("home.author") }}</span>
            <span v-if="timeAgo(item.kMeta?.createdAt)"> · {{ timeAgo(item.kMeta.createdAt) }}</span>
            <span v-if="item.kMeta?.language"> · {{ item.kMeta.language }}</span>
          </p>
          <p v-if="item.body" class="bounty-reply-body">{{ toPlain(item.body) }}</p>
          <RecordMedia :images="item.images" :audio="item.audio" :label="altLabel(item.body)" />
          <ul v-if="fileRows(item).length" class="wish-files">
            <li v-for="(file, index) in fileRows(item)" :key="`${file.name}-${index}`" class="wish-file">
              <PaperclipIcon class="wish-file-icon" aria-hidden="true" />
              <span class="information-file-copy">
                <span class="information-file-name">{{ file.name }}</span><span v-if="file.note" class="information-file-note">{{ t("home.fileNoteJoin", { note: file.note }) }}</span>
              </span>
            </li>
          </ul>
          <VideoFrame v-if="item.videos?.[0]" :url="item.videos[0].url" :poster="item.videos[0].poster || ''" :play-url="item.videos[0].playUrl || ''" :label="altLabel(item.body)" />
          <AppButton
            v-if="fileRows(item).length"
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
          <ActorMark :actor="item.wish.actor" />
          <WishCopy v-if="item.wish.body" :body="item.wish.body" />
          <RecordMedia :images="item.wish.images" :audio="item.wish.audio" :label="altLabel(item.wish.body)" />
          <ul v-if="fileRows(item.wish).length" class="wish-files">
            <li v-for="(file, index) in fileRows(item.wish)" :key="`${file.name}-${index}`" class="wish-file">
              <PaperclipIcon class="wish-file-icon" aria-hidden="true" />
              <span class="information-file-copy">
                <span class="information-file-name">{{ file.name }}</span><span v-if="file.note" class="information-file-note">{{ t("home.fileNoteJoin", { note: file.note }) }}</span>
              </span>
            </li>
          </ul>
          <VideoFrame v-if="item.wish.videos?.[0]" :url="item.wish.videos[0].url" :poster="item.wish.videos[0].poster || ''" :play-url="item.wish.videos[0].playUrl || ''" :label="altLabel(item.wish.body)" />
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
                  <ActorMark :actor="reply.actor" />
                  <p class="wish-responses-label">{{ t("wish.myReply") }}</p>
                  <p v-if="reply.kMeta?.verdict !== 'passed'" class="information-status">
                    <StatusIcon :verdict="reply.kMeta?.verdict || 'pending'" />
                    {{ t(statusKey(reply.kMeta?.verdict)) }}
                  </p>
                </div>
                <p class="bounty-reply-meta">
                  <span>{{ t("wish.replyPrice", { n: priceOf(reply) }) }}</span>
                  <span v-if="timeAgo(reply.kMeta?.createdAt)"> · {{ timeAgo(reply.kMeta.createdAt) }}</span>
                  <span v-if="reply.kMeta?.language"> · {{ reply.kMeta.language }}</span>
                </p>
                <p v-if="reply.kMeta?.verdict === 'rejected' && reply.kMeta?.rejectReason" class="wish-reason">{{ reply.kMeta.rejectReason }}</p>
                <p v-if="reply.body" class="bounty-reply-body">{{ toPlain(reply.body) }}</p>
                <RecordMedia :images="reply.images" :audio="reply.audio" :label="altLabel(reply.body)" />
                <ul v-if="fileRows(reply).length" class="wish-files">
                  <li v-for="(file, index) in fileRows(reply)" :key="`${file.name}-${index}`" class="wish-file">
                    <PaperclipIcon class="wish-file-icon" aria-hidden="true" />
                    <span class="information-file-copy">
                      <span class="information-file-name">{{ file.name }}</span><span v-if="file.note" class="information-file-note">{{ t("home.fileNoteJoin", { note: file.note }) }}</span>
                    </span>
                  </li>
                </ul>
                <VideoFrame v-if="reply.videos?.[0]" :url="reply.videos[0].url" :poster="reply.videos[0].poster || ''" :play-url="reply.videos[0].playUrl || ''" :label="altLabel(reply.body)" />
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
                    :show-price="replyFiles.length > 0"
                    :show-free-note="false"
                    :poster-preview="replyPosterPreview"
                    price-id="wish-reply-price"
                    :busy="busy"
                    @remove-image="removeReplyImage"
                    @remove-audio="removeReplyAudio"
                    @remove-file="removeReplyFile"
                    @pick-poster="replyPosterInput?.click()"
                    @remove-poster="removeReplyPoster"
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
            <ActorMark :actor="item.actor" />
            <p class="wish-responses-label">{{ t("wish.myReply") }}</p>
            <p v-if="item.kMeta?.verdict !== 'passed'" class="information-status">
              <StatusIcon :verdict="item.kMeta?.verdict || 'pending'" />
              {{ t(statusKey(item.kMeta?.verdict)) }}
            </p>
          </div>
          <p v-if="item.body" class="bounty-reply-body">{{ toPlain(item.body) }}</p>
        </div>
      </article>
      <input ref="replyImageInput" type="file" accept="image/*" multiple class="visually-hidden" @change="pickReplyImages" />
      <input ref="replyFileInput" type="file" :accept="ATTACHMENT_ACCEPT" multiple class="visually-hidden" @change="pickReplyFiles" />
      <input ref="replyAudioInput" type="file" accept="audio/*" class="visually-hidden" @change="pickReplyAudio" />
      <input ref="replyPosterInput" type="file" accept="image/*" class="visually-hidden" @change="pickReplyPoster" />
    </div>

    <section class="card share-bar wish-compose" :aria-label="composeMode === 'sale' ? t('wish.saleCompose') : t('wish.compose')">
      <button v-if="!composeOpen" type="button" class="share-prompt wish-compose-prompt" @click="openCompose">
        <span class="share-avatar" aria-hidden="true">
          <img v-if="session.user?.avatarUrl" :src="session.user.avatarUrl" alt="" />
          <UserIcon v-else />
        </span>
        <span class="share-pill">{{ t("wish.composePrompt") }}</span>
        <PlusIcon class="wish-compose-icon" aria-hidden="true" />
      </button>

      <template v-else>
        <form id="wish-form" class="share-dialog" @submit.prevent="submit">
          <PacketMediaFields
            ref="fields"
            v-model:body="body"
            v-model:video="video"
            v-model:price="price"
            body-id="wish-body"
            :body-label="composeMode === 'sale' ? t('wish.saleTitle') : t('wish.title')"
            :placeholder="composeMode === 'sale' ? t('wish.salePlaceholder') : t('wish.placeholder')"
            :rows="2"
            grow
            :video-open="videoOpen"
            :previews="previewUrls"
            :audio-name="audio?.name || ''"
            :files="files"
            :show-price="composeMode === 'sale' && files.length > 0"
            :show-free-note="false"
            :poster-preview="posterPreview"
            price-id="wish-price"
            :busy="busy"
            @remove-image="removeImage"
            @remove-audio="removeAudio"
            @remove-file="removeFile"
            @pick-poster="posterInput?.click()"
            @remove-poster="removePoster"
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
        <div v-if="composeMode === 'wish'" class="wish-duration">
          <label class="wish-duration-label" for="wish-hours">{{ t("wish.hoursLabel") }}</label>
          <input
            id="wish-hours"
            v-model="hours"
            class="wish-duration-input"
            type="number"
            min="1"
            max="24"
            step="1"
            inputmode="numeric"
            :disabled="busy"
          />
          <span class="wish-duration-unit">{{ t("wish.hoursUnit") }}</span>
          <span class="wish-duration-hint">{{ t("wish.hoursHint") }}</span>
        </div>
        <div class="wish-submit-row">
          <label v-if="composeMode === 'wish'" class="wish-consent">
            <input v-model="agreed" type="checkbox" :disabled="busy" />
            <span>{{ t("wish.consent") }}</span>
          </label>
          <AppButton
            class="wish-send"
            variant="icon"
            type="submit"
            form="wish-form"
            :aria-label="composeMode === 'sale' ? t('wish.saleSend') : t('wish.send')"
            :disabled="busy || !canSend() || (composeMode === 'wish' && !agreed)"
          >
            <SendIcon aria-hidden="true" />
          </AppButton>
        </div>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <input ref="imageInput" type="file" accept="image/*" multiple class="visually-hidden" @change="pickImages" />
        <input ref="fileInput" type="file" :accept="ATTACHMENT_ACCEPT" multiple class="visually-hidden" @change="pickFiles" />
        <input ref="audioInput" type="file" accept="audio/*" class="visually-hidden" @change="pickAudio" />
        <input ref="posterInput" type="file" accept="image/*" class="visually-hidden" @change="pickPoster" />
      </template>
    </section>
  </div>
</template>
