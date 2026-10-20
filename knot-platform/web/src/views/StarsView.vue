<script setup>
import { onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import AppButton from "../components/AppButton.vue";
import InformationCard from "../components/InformationCard.vue";
import { StarIcon } from "../icons/index.js";
import { addCardFriend, dismissInformation, downloadInformation, downloadShare, likeInformation, listStars, removeCardFriend, unlikeInformation, unstarInformation } from "../api.js";
import { acceptDownload } from "../download/consent.js";
import { cardIsMine } from "../discoverBoard.js";
import { feeOf, priceOf } from "../record.js";
import { t } from "../i18n/index.js";
import { useFriendStore } from "../stores/friends";
import { useSessionStore } from "../stores/session";

const session = useSessionStore();
const router = useRouter();
const friends = useFriendStore();
const items = ref([]);
const loaded = ref(false);
const failed = ref(false);

function filterByAuthor(item) {
  const id = item?.author?.id;
  if (!id) return;
  router.push({ name: "discover", query: { author: id } });
}

async function shareItem(item) {
  if (item.sharing) return;
  item.sharing = true;
  item.shareError = "";
  try {
    await downloadShare(item.id);
  } catch {
    item.shareError = t("error.request_failed");
  } finally {
    item.sharing = false;
  }
}

async function downloadItem(item) {
  if (item.downloading) return;
  item.downloading = true;
  try {
    if (session.user) await session.load();
    const ok = await acceptDownload({
      price: priceOf(item),
      fee: feeOf(item),
      granted: item.granted === true,
      mine: Boolean(session.user) && item.canFriend === false,
      balance: session.user?.pointsBalance,
      code: session.user ? "" : "no_session",
      task: () => downloadInformation(item.id),
    });
    if (!ok) return;
    try {
      const data = await listStars();
      const next = (data.information || []).find((row) => row.id === item.id);
      if (next) Object.assign(item, next);
      else item.granted = true;
      await session.load();
    } catch {
      item.granted = true;
    }
  } finally {
    item.downloading = false;
  }
}

async function toggleStar(item) {
  const previous = items.value;
  items.value = items.value.filter((row) => row.id !== item.id);
  try {
    await unstarInformation(item.id);
  } catch (error) {
    if (error.status !== 401) items.value = previous;
  }
}

async function toggleLike(item) {
  const previous = Boolean(item.liked);
  item.liked = !previous;
  try {
    if (item.liked) await likeInformation(item.id);
    else await unlikeInformation(item.id);
  } catch {
    item.liked = previous;
  }
}

async function toggleFriend(item) {
  if (!item.canFriend) return;
  const previous = Boolean(item.friend);
  item.friend = !previous;
  try {
    const data = item.friend ? await addCardFriend(item.id) : await removeCardFriend(item.id);
    item.friend = Boolean(data.friend);
    await friends.load();
  } catch {
    item.friend = previous;
  }
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

async function load() {
  if (!session.user) {
    items.value = [];
    loaded.value = true;
    return;
  }
  try {
    const data = await listStars();
    items.value = data.information || [];
    failed.value = false;
  } catch {
    failed.value = true;
  } finally {
    loaded.value = true;
  }
}

watch(
  () => friends.revision,
  () => {
    if (friends.revision) load();
  }
);

onMounted(load);
</script>

<template>
  <h1 class="page-title">{{ t("stars.title") }}</h1>
  <div v-if="!session.user" class="guest-prompt">
    <p class="muted">{{ t("mine.login") }}</p>
    <div class="form-actions">
      <AppButton to="/">{{ t("remember.guestAction") }}</AppButton>
    </div>
  </div>
  <p v-else-if="failed" class="error" role="alert">{{ t("error.request_failed") }}</p>
  <template v-else-if="loaded">
    <InformationCard
      v-for="item in items"
      :key="item.id"
      :post-id="item.id"
      :body="item.body || ''"
      :category="item.kMeta?.category || ''"
      :language="item.kMeta?.language || ''"
      :price="priceOf(item)"
      :granted="item.granted !== false"
      :images="item.images || []"
      :audio="item.audio || []"
      :videos="item.videos || []"
      :attachments="item.attachments || []"
      :note="item.kMeta?.note || ''"
      :verdict="item.kMeta?.verdict || ''"
      :author-id="item.author?.id || ''"
      :author-name="item.author?.name || ''"
      :avatar-url="item.author?.avatarUrl || ''"
      :actor="item.actor || ''"
      :created-at="item.kMeta?.createdAt || ''"
      :kind="item.kMeta?.kind || ''"
      :expires-at="item.kMeta?.expiresAt || ''"
      :mine="cardIsMine(item, session.user)"
      :starred="true"
      :liked="Boolean(item.liked)"
      :friend="Boolean(item.friend)"
      :can-friend="Boolean(item.canFriend)"
      :busy="Boolean(item.downloading)"
      :sharing="Boolean(item.sharing)"
      :notice="item.shareError || ''"
      @author="filterByAuthor(item)"
      @friend="toggleFriend(item)"
      @dismiss="dismissItem(item)"
      @star="toggleStar(item)"
      @like="toggleLike(item)"
      @download="downloadItem(item)"
      @share="shareItem(item)"
    />
    <p v-if="items.length === 0" class="muted empty-line">
      <StarIcon class="empty-icon" aria-hidden="true" />
      <span>{{ t("stars.empty") }}</span>
    </p>
  </template>
</template>
