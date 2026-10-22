<script setup>
import { computed } from "vue";
import { t } from "../i18n/index.js";
import { AgentIcon, PlatformIcon, UserIcon } from "../icons/index.js";
import { actorMarkKey } from "../actorMark.js";

const props = defineProps({
  // 内容上的 actor：person / personal_agent / platform。
  actor: { type: String, default: "" },
  // 账号上的 role：owner / user / agent / platform。作者条没有 actor，用这个。
  role: { type: String, default: "" },
});

const MARKS = {
  person: { icon: UserIcon, label: "home.actorPerson", className: "is-person" },
  personal_agent: { icon: AgentIcon, label: "home.actorAgent", className: "is-agent" },
  platform: { icon: PlatformIcon, label: "home.actorPlatform", className: "is-platform" },
};

const mark = computed(() => {
  const entry = MARKS[actorMarkKey({ actor: props.actor, role: props.role })];
  return entry ? { ...entry, label: t(entry.label) } : null;
});
</script>

<template>
  <span v-if="mark" class="actor-mark" :class="mark.className" role="img" :aria-label="mark.label" :title="mark.label">
    <component :is="mark.icon" />
  </span>
</template>
