<script setup>
import { onMounted, ref } from "vue";
import InformationCard from "../components/InformationCard.vue";
import { dismissInformation, downloadInformation, listStars, unstarInformation } from "../api.js";
import { t } from "../i18n/index.js";
import { useSessionStore } from "../stores/session";

const session = useSessionStore();
const items = ref([]);
const loaded = ref(false);
const failed = ref(false);

async function downloadItem(item) {
  if (item.downloading) return;
  item.notice = "";
  item.downloading = true;
  try {
    await downloadInformation(item.id);
    const data = await listStars();
    const next = (data.information || []).find((row) => row.id === item.id);
    if (next) Object.assign(item, next, { notice: "", downloading: false });
    else item.granted = true;
    await session.load();
  } catch (error) {
    const key = `error.${error.code}`;
    item.notice = t(key) === key ? t("error.request_failed") : t(key);
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

async function dismissItem(item) {
  const previous = items.value;
  items.value = items.value.filter((row) => row.id !== item.id);
  try {
    await dismissInformation(item.id);
  } catch (error) {
    if (error.status !== 401) items.value = previous;
  }
}

onMounted(async () => {
  if (!session.user) {
    loaded.value = true;
    return;
  }
  try {
    const data = await listStars();
    items.value = data.information || [];
  } catch {
    failed.value = true;
  } finally {
    loaded.value = true;
  }
});
</script>

<template>
  <h1 class="page-title">{{ t("stars.title") }}</h1>
  <p v-if="!session.user" class="muted">{{ t("mine.login") }}</p>
  <p v-else-if="failed" class="error" role="alert">{{ t("error.request_failed") }}</p>
  <template v-else-if="loaded">
    <InformationCard
      v-for="item in items"
      :key="item.id"
      :body="item.body || ''"
      :category="item.category || ''"
      :price="Number(item.price) || 0"
      :granted="item.granted !== false"
      :image-urls="item.imageUrls || item.images?.map((file) => file.url).filter(Boolean) || []"
      :images="item.images || []"
      :audio="item.audio || []"
      :videos="item.videos || []"
      :attachments="item.attachments || []"
      :author-name="item.author?.name || ''"
      :avatar-url="item.author?.avatarUrl || ''"
      :created-at="item.createdAt || ''"
      :starred="true"
      :busy="Boolean(item.downloading)"
      :notice="item.notice || ''"
      @dismiss="dismissItem(item)"
      @star="toggleStar(item)"
      @download="downloadItem(item)"
    />
    <p v-if="items.length === 0" class="muted">{{ t("stars.empty") }}</p>
  </template>
</template>
