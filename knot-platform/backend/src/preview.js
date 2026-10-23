import { verdictVisible } from "./information.js";
import { walletOf } from "./points.js";
import { cardImageUrl } from "./uploads.js";

// 一个上传件对谁可读：
//   "public"  未登录也能读（公开帖子上的图、wish 的图）
//   "private" 只有当事人能读（作者本人、wish 的收件人）
//   null      都读不到
// 有「private」这个中间档，是因为缓存头要跟着可见范围走：公开的可以给入口缓存，
// 当事人专属的只能给浏览器缓存，不能进共享缓存。
export const MEDIA_PUBLIC = "public";
export const MEDIA_PRIVATE = "private";

// 封面图存在 intel.videos 的 poster 字段里，不进 intel_files（否则会被当成正文图片）。
// 所以直链可读性除了看 intel_files，还要看有没有已公开的帖子拿它当视频封面。
// 两条来源一次查完，调用方只需要一次往返。
export async function mediaAudience(pool, uploadId, userId) {
  const { rows } = await pool.query(
    `SELECT i.account_id, i.kind, i.is_public, i.verdict, parent.account_id AS wish_account_id,
            COALESCE(owner.owner_id, owner.id) AS wallet,
            COALESCE(wisher.owner_id, wisher.id) AS wish_wallet
     FROM intel_files f
     JOIN intel i ON i.id = f.intel_id
     JOIN accounts owner ON owner.id = i.account_id
     LEFT JOIN intel parent ON parent.id = i.responds_to AND parent.kind = 'wish'
     LEFT JOIN accounts wisher ON wisher.id = parent.account_id
     WHERE f.upload_id = $1
     UNION
     SELECT i.account_id, i.kind, i.is_public, i.verdict, NULL::uuid AS wish_account_id,
            COALESCE(owner.owner_id, owner.id) AS wallet,
            NULL::uuid AS wish_wallet
     FROM intel i
     JOIN accounts owner ON owner.id = i.account_id
     WHERE i.videos @> jsonb_build_array(jsonb_build_object('poster', $2::text))`,
    [uploadId, cardImageUrl(String(uploadId || "").toLowerCase())]
  );
  // 公开优先于「你是作者」：同一条记录既是自己的、又是公开的，就按公开缓存。
  // 先走完这一轮再决定要不要查查看者的钱包——公开图片是大多数，不该为它多打一次库。
  for (const row of rows) {
    const visible = verdictVisible(row.verdict);
    if (!visible) continue;
    if ((row.kind === "post" || row.kind === "fastpost") && row.is_public) return MEDIA_PUBLIC;
    if (row.kind === "wish") return MEDIA_PUBLIC;
  }
  if (!userId) return null;
  // 钱包归属：Agent 的附件，它的主人也能看——钱、通知、好友都按钱包算，附件不该例外。
  const wallet = await walletOf(pool, userId);
  if (!wallet) return null;
  let audience = null;
  for (const row of rows) {
    const visible = verdictVisible(row.verdict);
    // 作者本人不限终审状态：撤销或删除之后，自己的提交记录里还要能看原图。
    if (row.wallet === wallet) audience = MEDIA_PRIVATE;
    else if (visible && row.kind === "wishRespond" && row.wish_wallet === wallet) audience = MEDIA_PRIVATE;
  }
  if (audience) return audience;
  // 还没挂到任何记录上的上传（发布框里的预览）也要能被上传者自己看见。
  const { rows: owned } = await pool.query(
    `SELECT COALESCE(owner.owner_id, owner.id) AS wallet
     FROM uploads u
     JOIN accounts owner ON owner.id = u.account_id
     WHERE u.id = $1`,
    [uploadId]
  );
  return owned[0]?.wallet === wallet ? MEDIA_PRIVATE : null;
}

export async function directMediaReadable(pool, uploadId, userId) {
  return (await mediaAudience(pool, uploadId, userId)) !== null;
}
