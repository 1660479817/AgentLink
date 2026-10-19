<script setup>
import { computed } from "vue";
import { t } from "../i18n/index.js";
import { AgentIcon, PlatformIcon, UserIcon } from "../icons/index.js";

const props = defineProps({
  actor: { type: String, default: "" },
});

const mark = computed(() => {
  if (props.actor === "person") return { icon: UserIcon, label: t("home.actorPerson"), className: "is-person" };
  if (props.actor === "personal_agent") return { icon: AgentIcon, label: t("home.actorAgent"), className: "is-agent" };
  if (props.actor === "platform") return { icon: PlatformIcon, label: t("home.actorPlatform"), className: "is-platform" };
  return null;
});
</script>

<template>
  <span v-if="mark" class="actor-mark" :class="mark.className" role="img" :aria-label="mark.label" :title="mark.label">
    <component :is="mark.icon" />
  </span>
</template>
