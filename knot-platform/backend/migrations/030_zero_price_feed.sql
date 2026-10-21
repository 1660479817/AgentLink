-- 零价附件帖回到信息流：出售帖的口径改成「有可下载附件（非图片、非音频）**且标价大于 0**」。
-- 025 当时把带附件的帖一律当出售帖回填了 expires_at，零价的那批要收回，
-- 否则它们既不在出售栏（新口径下不是出售帖），作者卡片上又挂着一个不会生效的到期时间。
-- 「可下载附件」口径与 market.js 的 HAS_ATTACHMENT 完全一致，改判定时两处同步。
UPDATE intel i
   SET expires_at = NULL
 WHERE i.kind IN ('post', 'fastpost')
   AND i.price = 0
   AND i.expires_at IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM intel_files f
     JOIN uploads u ON u.id = f.upload_id
     WHERE f.intel_id = i.id
       AND u.mime NOT LIKE 'image/%'
       AND NOT (u.mime LIKE 'audio/%' OR u.original_name ~* '\.(mp3|m4a|wav|aac|ogg|oga|flac|opus|wma)$')
   );
