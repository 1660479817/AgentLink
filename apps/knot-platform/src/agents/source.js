export function suggest(processed) {
  return `还没有对得上的供给。可以把「${processed}」写得更具体，或继续寻找。`;
}

export function leadText(notes) {
  const lines = notes.map((note) => String(note || "").trim()).filter(Boolean).slice(0, 3);
  if (!lines.length) return "";
  return `供给线索：${lines.join("；")}`;
}
