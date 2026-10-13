<script setup>
import { computed, onMounted, ref, watch } from "vue";
import AppButton from "../components/AppButton.vue";
import BountyReplyComposer from "../components/BountyReplyComposer.vue";
import InformationCard from "../components/InformationCard.vue";
import RememberLoginCard from "../components/RememberLoginCard.vue";
import ShareComposer from "../components/ShareComposer.vue";
import SnapComposer from "../components/SnapComposer.vue";
import { useRoute, useRouter } from "vue-router";
import { dismissInformation, downloadInformation, listBounties, listInformation, searchInformation, starInformation, unstarInformation } from "../api.js";
import { errorText, nameMark, requireSession } from "../composers/packet.js";
import { t } from "../i18n/index.js";
import { ClockIcon, PlusIcon, UserIcon } from "../icons/index.js";
import { useNotificationStore } from "../stores/notifications";
import { useSessionStore } from "../stores/session";

const items = ref([]);
const bounties = ref([]);
const surface = ref(null);
const shareFocus = ref({ kind: "text", n: 0 });
const bountyId = ref("");
const notifications = useNotificationStore();
const session = useSessionStore();
const route = useRoute();
const router = useRouter();
const searchQ = computed(() => String(route.query.q || "").trim());
const createMark = computed(() => nameMark(session.user));
const activeBounty = computed(() => bounties.value.find((item) => item.id === bountyId.value) || null);

onMounted(load);
watch(searchQ, load);
watch(
  () => [String(route.query.bounty || ""), bounties.value.map((item) => item.id).join(",")],
  () => {
    const id = String(route.query.bounty || "");
    if (!id) return;
    const bounty = bounties.value.find((item) => item.id === id && item.mine);
    if (!bounty || (surface.value === "bounty" && bountyId.value === id)) return;
    surface.value = "bounty";
    bountyId.value = id;
  }
);

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

function clearBountyQuery() {
  if (!route.query.bounty) return;
  const query = { ...route.query };
  delete query.bounty;
  router.replace({ name: "home", query });
}

function openSnap() {
  if (surface.value === "snap") {
    surface.value = null;
    return;
  }
  surface.value = "snap";
  bountyId.value = "";
  clearBountyQuery();
}

function openShare(kind) {
  surface.value = "share";
  bountyId.value = "";
  shareFocus.value = { kind, n: shareFocus.value.n + 1 };
  clearBountyQuery();
}

function openBounty(bounty) {
  if (surface.value === "bounty" && bountyId.value === bounty.id) {
    closeSurface();
    return;
  }
  clearBountyQuery();
  surface.value = "bounty";
  bountyId.value = bounty.id;
}

function closeSurface() {
  surface.value = null;
  bountyId.value = "";
  clearBountyQuery();
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
  item.notice = "";
  item.downloading = true;
  try {
    requireSession(session.user);
    await downloadInformation(item.id);
    const data = searchQ.value ? await searchInformation(searchQ.value) : await listInformation();
    const next = (data.information || []).find((row) => row.id === item.id);
    if (next) Object.assign(item, next, { notice: "", downloading: false });
    else item.granted = true;
    if (session.user) await session.load();
  } catch (err) {
    item.notice = errorText(err.code, session.policy);
  } finally {
    item.downloading = false;
  }
}
</script>

<template>
  <RememberLoginCard v-if="!searchQ" />

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
      <button
        v-for="bounty in bounties"
        :key="bounty.id"
        type="button"
        class="intel-bounty"
        :aria-pressed="surface === 'bounty' && bountyId === bounty.id"
        @click="openBounty(bounty)"
      >
        <span class="intel-bounty-body">
          <span class="intel-bounty-text">{{ bounty.body }}</span>
        </span>
        <span class="intel-bounty-reward">
          <ClockIcon class="intel-bounty-mark" aria-hidden="true" />
          <span>{{ bountyLabel(bounty) }}</span>
          <span v-if="bounty.mine">{{ t("home.bountyReplyCount", { n: bounty.responseCount || 0 }) }}</span>
        </span>
      </button>
    </div>
  </section>

  <SnapComposer v-if="surface === 'snap'" @close="closeSurface" @done="afterPost" />
  <BountyReplyComposer
    v-else-if="surface === 'bounty' && activeBounty"
    :bounty="activeBounty"
    @close="closeSurface"
    @done="afterPost"
  />

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
    :starred="Boolean(item.starred)"
    :can-star="Boolean(session.user)"
    :busy="Boolean(item.downloading)"
    :notice="item.notice || ''"
    @dismiss="dismissItem(item)"
    @star="toggleStar(item)"
    @download="downloadItem(item)"
  />
  <p v-if="items.length === 0" class="muted feed-empty">
    {{ searchQ ? t("home.searchEmpty") : t("home.empty") }}
  </p>
</template>
