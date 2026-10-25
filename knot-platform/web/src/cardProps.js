// 一张 InformationCard 有二十多个 prop，信息流、收藏页、货架三处各写一遍时就开始不一致了：
// 漏一个 `topics`、少一个 `can-close`，卡片看起来一样，行为却不同。
// 这里把「一条记录 + 本页上下文」翻成卡片 props，三处共用；视图只补自己的监听。

import { cardBought, cardIsMine } from "./discoverBoard.js";
import { priceOf } from "./record.js";

// 一件商品在 Store 里有货架状态；帖子没有，也不会有。
function isStoreItem(item) {
  return Boolean(item?.store) || item?.kMeta?.kind === "item";
}

/**
 * @param {object} item 后端返回的一条记录
 * @param {{ session?: object, category?: string, topic?: string, author?: string, starred?: boolean,
 *           notice?: string, canClose?: boolean, busy?: boolean,
 *           canStar?: boolean, canTip?: boolean, canDismiss?: boolean, price?: number }} [ctx]
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
    // 货架自己的行里已经有价格，卡片上不必再画一次；用 ctx.price 覆盖。
    price: typeof ctx.price === "number" ? ctx.price : priceOf(item),
    tipTotal: Number(item?.tipTotal) || 0,
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
    mine: cardIsMine(item, session.user),
    // 内容没有可买的东西，附件始终能取；商品要买过（或本人）才能取。
    canDownload: !isStoreItem(item) || cardBought(item, session.user),
    starred: typeof ctx.starred === "boolean" ? ctx.starred : Boolean(item?.starred),
    canStar: typeof ctx.canStar === "boolean" ? ctx.canStar : Boolean(session.user),
    canTip: ctx.canTip !== false,
    canDismiss: ctx.canDismiss !== false,
    friend: Boolean(item?.friend),
    canFriend: Boolean(item?.canFriend),
    busy: typeof ctx.busy === "boolean" ? ctx.busy : Boolean(item?.downloading),
    notice: ctx.notice || "",
    canClose: Boolean(ctx.canClose),
    closing: Boolean(item?.closing),
  };
}
