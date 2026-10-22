<script setup>
import { computed, ref } from "vue";
import { t } from "../i18n/index.js";
import ActorMark from "./ActorMark.vue";

const props = defineProps({
  query: { type: String, default: "" },
  author: { type: Object, default: null },
  category: { type: String, default: "" },
  topic: { type: String, default: "" },
  categories: { type: Array, default: () => [] },
  topics: { type: Array, default: () => [] },
});

const emit = defineEmits(["clear", "clear-key", "select"]);

// 类别和热词都可能很长（库里有上百个类别），候选区先各铺前 N 个，其余收进「更多」，点了原地追加。
const CANDIDATE_LIMIT = 8;
const showAll = ref(false);

const isAll = computed(() => !props.query && !props.author && !props.category && !props.topic);
// 已选中的值在状态胶囊里展示，候选区不再重复出现。
const activeCategories = computed(() => props.categories.filter((value) => value !== props.category));
const activeTopics = computed(() => props.topics.filter((value) => value !== props.topic));
const shownCategories = computed(() => (showAll.value ? activeCategories.value : activeCategories.value.slice(0, CANDIDATE_LIMIT)));
const shownTopics = computed(() => (showAll.value ? activeTopics.value : activeTopics.value.slice(0, CANDIDATE_LIMIT)));
const hiddenCount = computed(
  () =>
    Math.max(0, activeCategories.value.length - CANDIDATE_LIMIT) +
    Math.max(0, activeTopics.value.length - CANDIDATE_LIMIT)
);

function clearKey(key) {
  emit("clear-key", key);
}

function selectCategory(value) {
  if (props.category === value) emit("clear-key", "category");
  else emit("select", "category", value);
}

function selectTopic(value) {
  if (props.topic === value) emit("clear-key", "topic");
  else emit("select", "topic", value);
}
</script>

<template>
  <section class="card filter-bar" :aria-label="t('home.filter')">
    <div v-if="!isAll" class="filter-bar-active">
      <button type="button" class="filter-pill filter-pill-all" :aria-label="t('home.filterAll')" @click="emit('clear')">
        {{ t("home.filterAll") }}
      </button>
      <button
        v-if="query"
        type="button"
        class="filter-pill is-on"
        :aria-label="t('home.searchResults', { q: query })"
        @click="clearKey('q')"
      >
        <span class="filter-pill-value">{{ t("home.searchResults", { q: query }) }}</span>
        <span class="filter-pill-x" aria-hidden="true">×</span>
      </button>
      <button
        v-if="author"
        type="button"
        class="filter-pill is-on"
        :aria-label="t('home.filterValue', { label: t('home.filterAuthor'), value: author.name || t('home.author') })"
        @click="clearKey('author')"
      >
        <span class="filter-pill-label">{{ t("home.filterAuthor") }}</span>
        <ActorMark :role="author.role" />
        <span class="filter-pill-value">{{ author.name || t("home.author") }}</span>
        <span class="filter-pill-x" aria-hidden="true">×</span>
      </button>
      <button
        v-if="category"
        type="button"
        class="filter-pill is-on"
        :aria-label="t('home.filterValue', { label: t('home.filterCategory'), value: category })"
        @click="clearKey('category')"
      >
        <span class="filter-pill-label">{{ t("home.filterCategory") }}</span>
        <span class="filter-pill-value">{{ category }}</span>
        <span class="filter-pill-x" aria-hidden="true">×</span>
      </button>
      <button
        v-if="topic"
        type="button"
        class="filter-pill is-on"
        :aria-label="t('home.filterValue', { label: t('home.filterTopic'), value: topic })"
        @click="clearKey('topic')"
      >
        <span class="filter-pill-label">{{ t("home.filterTopic") }}</span>
        <span class="filter-pill-value">#{{ topic }}</span>
        <span class="filter-pill-x" aria-hidden="true">×</span>
      </button>
    </div>

    <div class="filter-bar-candidates">
      <span class="filter-bar-legend" aria-hidden="true">{{ t("home.filter") }}</span>
      <div
        v-if="activeCategories.length || activeTopics.length"
        class="filter-bar-scroller"
        role="group"
        :aria-label="t('home.filter')"
      >
        <button
          v-for="value in shownCategories"
          :key="value"
          type="button"
          class="filter-pill"
          :aria-label="t('home.filterValue', { label: t('home.filterCategory'), value })"
          @click="selectCategory(value)"
        >
          {{ value }}
        </button>
        <button
          v-for="value in shownTopics"
          :key="value"
          type="button"
          class="filter-pill filter-pill-topic"
          :aria-label="t('home.filterValue', { label: t('home.filterTopic'), value })"
          @click="selectTopic(value)"
        >
          <span class="filter-topic-hash" aria-hidden="true">#</span><span>{{ value }}</span>
        </button>
        <button
          v-if="hiddenCount > 0"
          type="button"
          class="filter-pill filter-pill-more"
          :aria-label="t('home.filterMore')"
          @click="showAll = true"
        >
          {{ t("home.filterMore") }}
        </button>
      </div>
      <p v-else class="muted filter-bar-empty">{{ t("home.filterNone") }}</p>
    </div>
  </section>
</template>
