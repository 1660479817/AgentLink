// 一条内容、一个账号背后是谁：人、Agent（机器人）还是平台。
//
// 两条来源：内容记录带 `actor`（这条是谁写的），账号带 `role`（这个身份是谁）。
// 卡片把人卡与 Agent 卡分开放，所以作者条要按 `role` 画；信息流卡片已经有 `actor`。
// 同一个判定只写一份，徽标组件与测试都走这里。

const ACTORS = new Set(["person", "personal_agent", "platform"]);

export function actorMarkKey({ actor = "", role = "" } = {}) {
  const source = String(actor || "");
  if (ACTORS.has(source)) return source;
  const kind = String(role || "");
  if (kind === "agent") return "personal_agent";
  if (kind === "platform") return "platform";
  if (kind === "owner" || kind === "user") return "person";
  return "";
}
