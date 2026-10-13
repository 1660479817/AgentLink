<script setup>
import { computed, onMounted, ref, watch } from "vue";
import AppButton from "../components/AppButton.vue";
import InformationCard from "../components/InformationCard.vue";
import ShareComposer from "../components/ShareComposer.vue";
import SnapComposer from "../components/SnapComposer.vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { dismissInformation, downloadInformation, listInformation, listRequests, searchInformation, starInformation, unstarInformation } from "../api.js";
import { nameMark } from "../composers/packet.js";
import { acceptDownload } from "../download/consent.js";
import { payeeOf, priceOf } from "../record.js";
import { t } from "../i18n/index.js";
import { PlusIcon, UserIcon } from "../icons/index.js";
import { useNotificationStore } from "../stores/notifications";
import { useSessionStore } from "../stores/session";

const items = ref([]);
const wishes = ref([]);
const surface = ref(null);
const shareFocus = ref({ kind: "text", n: 0 });
const notifications = useNotificationStore();
const session = useSessionStore();
const route = useRoute();
const router = useRouter();
const searchQ = computed(() => String(route.query.q || "").trim());
const createMark = computed(() => nameMark(session.user));

onMounted(load);
watch(searchQ, load);

async function load() {
  try {
    const q = searchQ.value;
    const data = q ? await searchInformation(q) : await listInformation();
    items.value = data.information;
  } catch {
    items.value = [];
  }
  try {
    const data = await listRequests();
    wishes.value = data.requests || [];
  } catch {
    wishes.value = [];
  }
}

function wishText(wish) {
  const body = String(wish.body || "").trim();
  if (body) return body;
  const file = [...(wish.images || []), ...(wish.audio || []), ...(wish.attachments || [])][0];
  return file?.name || file?.url || t("nav.wish");
}

function clearSearch() {
  router.push({ name: "home", query: {} });
}

function openSnap() {
  surface.value = surface.value === "snap" ? null : "snap";
}

function openShare(kind) {
  surface.value = "share";
  shareFocus.value = { kind, n: shareFocus.value.n + 1 };
}

function closeSurface() {
  surface.value = null;
}

async function afterPost() {
  closeSurface();
  await load();
  await notifications.load();
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

async function downloadItem(item) {
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
      const data = searchQ.value ? await searchInformation(searchQ.value) : await listInformation();
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
</script>

<template>
  <section v-if="searchQ" class="card search-context">
    <p class="search-context-label">{{ t("home.searchResults", { q: searchQ }) }}</p>
    <AppButton variant="secondary" @click="clearSearch">{{ t("home.clearSearch") }}</AppButton>
  </section>

  <ShareComposer
    v-if="!searchQ"
    :active="surface === 'share'"
    :focus-kind="shareFocus.kind"
    :focus-nonce="shareFocus.n"
    @activate="openShare"
    @close="closeSurface"
    @done="afterPost"
  />

  <section class="card intel-rail" :aria-label="t('home.storyRail')">
    <div class="intel-rail-viewport">
      <button type="button" class="intel-create" :aria-pressed="surface === 'snap'" @click="openSnap">
        <span class="intel-create-photo" aria-hidden="true">
          <img v-if="session.user?.avatarUrl" :src="session.user.avatarUrl" alt="" />
          <span v-else-if="createMark">{{ createMark }}</span>
          <UserIcon v-else />
        </span>
        <span class="intel-create-plus" aria-hidden="true">
          <PlusIcon />
        </span>
        <span class="intel-create-label">{{ t("home.storyCreate") }}</span>
      </button>
      <component
        :is="wish.mine ? RouterLink : 'div'"
        v-for="wish in wishes"
        :key="wish.id"
        class="intel-bounty"
        :to="wish.mine ? { name: 'wish', query: { wish: wish.id } } : undefined"
      >
        <span class="intel-bounty-body">
          <span class="intel-bounty-text">{{ wishText(wish) }}</span>
        </span>
        <span class="intel-bounty-reward">
          {{ wish.mine ? t("home.wishReplyCount", { n: wish.responseCount || 0 }) : t("nav.wish") }}
        </span>
      </component>
    </div>
  </section>

  <SnapComposer v-if="surface === 'snap'" @close="closeSurface" @done="afterPost" />

  <InformationCard
    v-for="item in items"
    :key="item.id"
    :body="item.body || ''"
    :category="item.kMeta?.category || ''"
    :price="priceOf(item)"
    :granted="item.granted !== false"
    :preview-url="item.previewUrl || ''"
    :image-urls="item.imageUrls || item.images?.map((file) => file.url).filter(Boolean) || []"
    :images="item.images || []"
    :audio="item.audio || []"
    :videos="item.videos || []"
    :attachments="item.attachments || []"
    :author-name="item.author?.name || ''"
    :avatar-url="item.author?.avatarUrl || ''"
    :created-at="item.kMeta?.createdAt || ''"
    :starred="Boolean(item.starred)"
    :can-star="Boolean(session.user)"
    :busy="Boolean(item.downloading)"
    @dismiss="dismissItem(item)"
    @star="toggleStar(item)"
    @download="downloadItem(item)"
  />
  <p v-if="items.length === 0" class="muted feed-empty">
    {{ searchQ ? t("home.searchEmpty") : t("home.empty") }}
  </p>
</template>
