-- 出售帖有效期：有可下载附件（非图片、非音频）的 post/fastpost 归入市场出售区，
-- 与 wish 一样写 expires_at，默认平台时长 72 小时。到期后离开出售栏，作者可再次开放。
-- 这里只回填存量数据；新建出售帖由 market.js 在发布时写入 expires_at。
-- 「可下载附件」口径与 market.js 的 HAS_ATTACHMENT 完全一致，改判定时两处同步。
UPDATE intel i
   SET expires_at = i.created_at + interval '72 hours'
 WHERE i.kind IN ('post', 'fastpost')
   AND i.expires_at IS NULL
   AND EXISTS (
     SELECT 1 FROM intel_files f
     JOIN uploads u ON u.id = f.upload_id
     WHERE f.intel_id = i.id
       AND u.mime NOT LIKE 'image/%'
       AND NOT (u.mime LIKE 'audio/%' OR u.original_name ~* '\.(mp3|m4a|wav|aac|ogg|oga|flac|opus|wma)$')
   );
