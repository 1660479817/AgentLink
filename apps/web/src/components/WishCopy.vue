<script setup>
import { computed } from "vue";

const props = defineProps({
  body: { type: String, default: "" },
});

const OPEN = new Set("「『（《〈【〖〔".split(""));
const CLOSE = new Set("」』）》〉】〗〕。，、；：！？…·.,)".split(""));
const GLUE = new Set("的了着过".split(""));

const segmenter = typeof Intl !== "undefined" && Intl.Segmenter
  ? new Intl.Segmenter("zh", { granularity: "word" })
  : null;

function piecesOf(text) {
  const parts = segmenter ? [...segmenter.segment(text)].map((part) => part.segment) : [text];
  const chunks = [];
  let pending = "";
  for (const part of parts) {
    if (!part) continue;
    if ([...part].every((ch) => OPEN.has(ch))) {
      pending += part;
      continue;
    }
    if (!part.trim() && chunks.length) {
      chunks[chunks.length - 1] += pending + part;
      pending = "";
      continue;
    }
    const closer = [...part].every((ch) => CLOSE.has(ch));
    const glue = GLUE.has(part);
    if ((closer || glue) && chunks.length) {
      chunks[chunks.length - 1] += pending + part;
      pending = "";
      continue;
    }
    chunks.push(pending + part);
    pending = "";
  }
  if (pending) chunks.push(pending);
  const merged = [];
  let hold = "";
  for (const chunk of chunks) {
    const single = chunk.length === 1 && /[\u3400-\u9fff]/.test(chunk);
    if (single && hold.length < 4) {
      hold += chunk;
      continue;
    }
    merged.push(hold + chunk);
    hold = "";
  }
  if (hold) {
    if (merged.length) merged[merged.length - 1] += hold;
    else merged.push(hold);
  }
  return merged.filter((piece) => piece.length);
}

function lineText(text) {
  return piecesOf(text)
    .map((piece) => (piece.length <= 16 ? [...piece].join("\u2060") : piece))
    .join("\u200b");
}

const blocks = computed(() => {
  const raw = String(props.body || "").replace(/\r\n/g, "\n").trim();
  if (!raw) return [];
  return raw
    .split(/\n{2,}/)
    .map((chunk) =>
      chunk
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length)
        .map((text) => ({ text: lineText(text), item: /^\d+[)）.、.]/.test(text) })),
    )
    .filter((lines) => lines.length);
});
</script>

<template>
  <div v-if="blocks.length" class="wish-copy">
    <div
      v-for="(lines, index) in blocks"
      :key="index"
      class="wish-copy-block"
      :class="{ 'is-title': index === 0 && blocks.length > 1 }"
    >
      <p
        v-for="(line, lineIndex) in lines"
        :key="lineIndex"
        :class="line.item ? 'wish-copy-item' : 'wish-copy-line'"
      >{{ line.text }}</p>
    </div>
  </div>
</template>
