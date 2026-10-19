export function mentionQuery(text) {
  const match = /(^|\s)@([^\s@]*)$/.exec(String(text || ""));
  return match ? match[2] : null;
}

export function withoutMentionQuery(text) {
  return String(text || "").replace(/(^|\s)@([^\s@]*)$/, (_all, lead) => lead).trimEnd();
}
