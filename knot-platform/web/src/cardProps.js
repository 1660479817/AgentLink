// 一张 InformationCard 有二十多个 prop，信息流、收藏页、出售栏三处各写一遍时就开始不一致了：
// 漏一个 `topics`、少一个 `can-close`，卡片看起来一样，行为却不同。
// 这里把「一条记录 + 本页上下文」翻成卡片 props，三处共用；视图只补自己的监听。

import { cardGranted, cardIsMine } from "./discoverBoard.js";
import { priceOf } from "./record.js";

/**
 * @param {object} item 后端返回的一条记录
 * @param {{ session?: object, category?: string, topic?: string, author?: string, starred?: boolean,
 *           notice?: string, canClose?: boolean, busy?: boolean }} [ctx]
 *   category/topic/author 是本页当前选中的筛选项，用来点亮卡片上的对应按钮。
 */
export function cardProps(item, ctx = {}) {
  const meta = item?.kMeta || {};
  const author = item?.author || {};
  const session = ctx.session || {};
  const category = String(ctx.category || "");
  const selectedAuthor = String(ctx.author || "");
  return {
    postId: item?.id || "",
    body: item?.body || "",
    category: meta.category || "",
    topics: meta.topics || [],
    categorySelected: Boolean(category) && category === (meta.category || ""),
    activeTopic: ctx.topic || "",
    language: meta.language || "",
    price: priceOf(item),
    tipTotal: Number(item?.tipTotal) || 0,
    granted: cardGranted(item, session.user),
    images: item?.images || [],
    audio: item?.audio || [],
    videos: item?.videos || [],
    attachments: item?.attachments || [],
    note: meta.note || "",
    verdict: meta.verdict || "",
    authorId: author.id || "",
    authorName: author.name || "",
    avatarUrl: author.avatarUrl || "",
    authorSelected: Boolean(selectedAuthor) && selectedAuthor === author.id,
    actor: item?.actor || "",
    createdAt: meta.createdAt || "",
    kind: meta.kind || "",
    expiresAt: meta.expiresAt || "",
    mine: cardIsMine(item, session.user),
    starred: typeof ctx.starred === "boolean" ? ctx.starred : Boolean(item?.starred),
    canStar: Boolean(session.user),
    friend: Boolean(item?.friend),
    canFriend: Boolean(item?.canFriend),
    busy: typeof ctx.busy === "boolean" ? ctx.busy : Boolean(item?.downloading),
    notice: ctx.notice || "",
    canClose: Boolean(ctx.canClose),
    closing: Boolean(item?.closing),
  };
}
