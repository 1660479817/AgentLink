<script setup>
import { onMounted, ref, watch } from "vue";
import AppButton from "../components/AppButton.vue";
import { CloseIcon, FriendsIcon, UserIcon } from "../icons/index.js";
import { errorText } from "../composers/packet.js";
import { t } from "../i18n/index.js";
import { useFriendStore } from "../stores/friends";
import { useSessionStore } from "../stores/session";

const session = useSessionStore();
const friends = useFriendStore();
const removeError = ref("");

function friendName(friend) {
  return friend.displayName || t("home.author");
}

async function removeListedFriend(id) {
  removeError.value = "";
  try {
    await friends.remove(id);
  } catch (error) {
    removeError.value = errorText(error.code);
  }
}

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
          <span class="friend-name">{{ friendName(friend) }}</span>
        </span>
        <AppButton
          variant="icon"
          type="button"
          :aria-label="t('home.removeFriend')"
          @click="removeListedFriend(friend.id)"
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
