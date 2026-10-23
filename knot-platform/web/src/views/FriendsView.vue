<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import AppButton from "../components/AppButton.vue";
import { CloseIcon, FriendsIcon, UserIcon } from "../icons/index.js";
import { errorText } from "../composers/packet.js";
import { t } from "../i18n/index.js";
import { useFriendStore } from "../stores/friends";
import { useSessionStore } from "../stores/session";

const session = useSessionStore();
const friends = useFriendStore();
const removeError = ref("");
// 二次确认：箭头键与拇指都容易点到这个紧挨名字的圆形按键，误删一次就没法撤销。
// 先点一下把这一行变成「确认移除 / 取消」，五秒不动就自己退回去。
const pendingRemove = ref("");
let pendingTimer = 0;
let confirmEl = null;

function confirmRef(el) {
  confirmEl = el;
}

function friendName(friend) {
  return friend.displayName || t("home.author");
}

async function askRemove(friend) {
  if (pendingRemove.value === friend.id) {
    await removeListedFriend(friend.id);
    return;
  }
  pendingRemove.value = friend.id;
  window.clearTimeout(pendingTimer);
  pendingTimer = window.setTimeout(() => {
    pendingRemove.value = "";
  }, 5000);
  // 确认键换上来之后把焦点送过去，键盘用户不用再从头 Tab 一遍。
  await nextTick();
  confirmEl?.$el?.focus?.();
}

function cancelRemove() {
  window.clearTimeout(pendingTimer);
  pendingRemove.value = "";
}

async function removeListedFriend(id) {
  removeError.value = "";
  try {
    await friends.remove(id);
    if (pendingRemove.value === id) cancelRemove();
  } catch (error) {
    removeError.value = errorText(error.code);
  }
}

onBeforeUnmount(() => window.clearTimeout(pendingTimer));

onMounted(() => friends.load());
watch(
  () => session.user?.id,
  () => friends.load()
);
</script>

<template>
  <h1 class="page-title">{{ t("friends.title") }}</h1>
  <div v-if="!session.user" class="guest-prompt">
    <p class="muted">{{ t("mine.login") }}</p>
    <div class="form-actions">
      <AppButton to="/">{{ t("remember.guestAction") }}</AppButton>
    </div>
  </div>
  <p v-else-if="friends.error" class="error" role="alert">{{ errorText(friends.error) }}</p>
  <template v-else-if="friends.loaded">
    <ul v-if="friends.items.length" class="card friend-list">
      <li v-for="friend in friends.items" :key="friend.id" class="friend-row">
        <span class="friend-who">
          <span class="friend-avatar" aria-hidden="true">
            <img v-if="friend.avatarUrl" :src="friend.avatarUrl" alt="" />
            <UserIcon v-else />
          </span>
          <span class="friend-id">
            <span class="friend-name">{{ friendName(friend) }}</span>
            <span class="friend-meta">
              <span class="friend-level">{{ t("friends.level", { level: friend.level }) }}</span>
              <span class="friend-points">{{ t("friends.pointsBalance", { balance: friend.pointsBalance }) }}</span>
            </span>
          </span>
        </span>
        <span v-if="pendingRemove === friend.id" class="friend-confirm">
          <AppButton
            ref="confirmRef"
            variant="secondary"
            type="button"
            @click="removeListedFriend(friend.id)"
          >
            {{ t("friends.confirmRemove") }}
          </AppButton>
          <AppButton variant="secondary" type="button" @click="cancelRemove">
            {{ t("friends.cancelRemove") }}
          </AppButton>
        </span>
        <AppButton
          v-else
          variant="icon"
          type="button"
          :aria-label="t('home.removeFriend')"
          @click="askRemove(friend)"
        >
          <CloseIcon aria-hidden="true" />
        </AppButton>
      </li>
    </ul>
    <p v-else class="muted empty-line">
      <FriendsIcon class="empty-icon" aria-hidden="true" />
      <span>{{ t("friends.empty") }}</span>
    </p>
    <p v-if="removeError" class="error" role="alert">{{ removeError }}</p>
  </template>
</template>
