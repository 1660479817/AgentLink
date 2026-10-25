<script setup>
import { onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import AppButton from "../components/AppButton.vue";
import InformationCard from "../components/InformationCard.vue";
import { StarIcon } from "../icons/index.js";
import { addCardFriend, dismissInformation, downloadInformation, listStars, removeCardFriend, unstarInformation } from "../api.js";
import { cardProps } from "../cardProps.js";
import { errorText } from "../composers/packet.js";
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

// 卡片上的分类是 emit，父级不接就等于按钮点了没反应。
function filterByCategory(item) {
  const category = String(item?.kMeta?.category || "").trim();
  if (!category) return;
  router.push({ name: "discover", query: { category } });
}

// 收藏页只有帖子，没有商品：附件直接取，不扣分、不弹确认。
async function downloadItem(item) {
  if (item.downloading) return;
  item.downloading = true;
  item.notice = "";
  try {
    await downloadInformation(item.id);
  } catch (error) {
    item.notice = errorText(error.code, session.policy);
  } finally {
    item.downloading = false;
  }
}

async function toggleStar(item) {
  const previous = items.value;
  items.value = items.value.filter((row) => row.id !== item.id);
  try {
    await unstarInformation(item.id);
  } catch {
    // 取消收藏失败（含 401）就把这条放回去：服务端还留着，界面不能先删。
    items.value = previous;
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
  } catch {
    // 同上：失败就还原，401 也是失败。
    items.value = previous;
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
      v-bind="cardProps(item, { session, starred: true })"
      @author="filterByAuthor(item)"
      @category="filterByCategory(item)"
      @friend="toggleFriend(item)"
      @dismiss="dismissItem(item)"
      @star="toggleStar(item)"
      @download="downloadItem(item)"
    />
    <p v-if="items.length === 0" class="muted empty-line">
      <StarIcon class="empty-icon" aria-hidden="true" />
      <span>{{ t("stars.empty") }}</span>
    </p>
  </template>
</template>
