import { createHash } from "node:crypto";
import { agentTypeSlug, GENERIC_AGENT_TYPE } from "./agentTypes.js";
import { publicUploadUrl } from "./uploads.js";

export const DEFAULT_AVATAR_COUNT = 16;

export function defaultAvatarIndex(userId) {
  const digest = createHash("sha256").update(String(userId)).digest();
  return digest.readUInt32BE(0) % DEFAULT_AVATAR_COUNT;
}

export function defaultAvatarUrl(userId) {
  return `/avatars/${String(defaultAvatarIndex(userId) + 1).padStart(2, "0")}.svg`;
}

// 没传过头像的 Agent 用哪张图。规则表在 agentTypes.js，这里只决定选哪一张：
//
//   自述过类型（accounts.agent_type 有值）→ 认得出就是那个产品的图，认不出是通用图。
//                                          认不出也不再回头猜称呼，否则改个名字就能
//                                          把 Agent 的自述盖掉。
//   没自述（老 Agent）                    → 退回按称呼猜，行为和加这个字段之前一样。
//   都认不出                              → 通用机器人图。
//
// 收一整行也行，收一个称呼也行：
//   agentAvatarSlug({ agent_type: "doubao" }) / agentAvatarSlug("豆包二号")
export function agentAvatarSlug(rowOrName) {
  const row = rowOrName && typeof rowOrName === "object" ? rowOrName : { display_name: rowOrName };
  const declared = String(row.agent_type ?? "").trim();
  if (declared) return agentTypeSlug(declared) || GENERIC_AGENT_TYPE;
  return agentTypeSlug(row.display_name) || GENERIC_AGENT_TYPE;
}

export function agentAvatarUrl(rowOrName) {
  return `/avatars/agents/${agentAvatarSlug(rowOrName)}.svg`;
}

export function avatarUrlFor(row) {
  if (!row) return null;
  // 自己传的图永远优先：Agent 换了头像，自述的类型也盖不过它。
  if (row.avatar_upload_id) return publicUploadUrl(row.avatar_upload_id);
  // Agent 是账户名下的一行，别让它按人像哈希，按类型（或称呼）给它一张 Agent 图。
  if (row.role === "agent") return agentAvatarUrl(row);
  const id = row.account_id || row.id;
  if (!id) return null;
  return defaultAvatarUrl(id);
}
