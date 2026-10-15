<script setup>
import { computed, watch } from "vue";
import { t } from "../i18n/index.js";
import { CloseIcon, UserIcon } from "../icons/index.js";
import { mentionQuery, withoutMentionQuery } from "../mentions.js";
import { useFriendStore } from "../stores/friends";

const mentions = defineModel({ default: () => [] });
const body = defineModel("body", { type: String, default: "" });
const open = defineModel("open", { type: Boolean, default: false });

defineProps({
  disabled: { type: Boolean, default: false },
});

const friends = useFriendStore();

const query = computed(() => mentionQuery(body.value));
const visible = computed(() =>
  friends.items.filter((friend) => {
    if (mentions.value.some((item) => item.id === friend.id)) return false;
    const q = String(query.value || "").trim().toLowerCase();
    if (!q) return true;
    return (friend.displayName || "").toLowerCase().includes(q);
  })
);

watch(query, (value, previous) => {
  if (value !== null && value !== previous) open.value = true;
});

watch(open, (value) => {
  if (value) friends.load();
});

function nameOf(friend) {
  return friend.displayName || t("home.author");
}

function pick(friend) {
  if (!mentions.value.some((item) => item.id === friend.id)) {
    mentions.value = [...mentions.value, { id: friend.id, displayName: friend.displayName || "" }];
  }
  if (query.value !== null) body.value = withoutMentionQuery(body.value);
  open.value = false;
}

function remove(id) {
  mentions.value = mentions.value.filter((item) => item.id !== id);
}
</script>

<template>
  <div v-if="mentions.length || open" class="mention-box">
    <ul v-if="mentions.length" class="mention-chips">
      <li v-for="friend in mentions" :key="friend.id">
        <button
          type="button"
          class="mention-chip"
          :disabled="disabled"
          :aria-label="t('home.mentionRemove', { name: nameOf(friend) })"
          @click="remove(friend.id)"
        >
          <span>@{{ nameOf(friend) }}</span>
          <CloseIcon aria-hidden="true" />
        </button>
      </li>
    </ul>
    <ul v-if="open" class="mention-menu" role="listbox" :aria-label="t('home.mention')">
      <li v-if="friends.error === 'no_session'" class="mention-empty">{{ t("mine.login") }}</li>
      <li v-else-if="friends.error" class="mention-empty">{{ t("error.request_failed") }}</li>
      <li v-else-if="!visible.length" class="mention-empty">{{ t("home.mentionEmpty") }}</li>
      <li v-for="friend in visible" :key="friend.id">
        <button type="button" class="mention-option" role="option" :disabled="disabled" @click="pick(friend)">
          <span class="mention-avatar" aria-hidden="true">
            <img v-if="friend.avatarUrl" :src="friend.avatarUrl" alt="" />
            <UserIcon v-else />
          </span>
          <span>{{ nameOf(friend) }}</span>
        </button>
      </li>
    </ul>
  </div>
</template>
