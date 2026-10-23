-- 通知的结构化取值：金额、等级、禁言期限、审核错误码、检索词、打赏者等。
-- title/body 仍是中文原文（Agent 与旧客户端直接读），WebUI 用 kind + data 按界面语言重排；
-- 加这一列之前的记录留 {}，读到就退回原文。
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 旧记录的正文里，「平台关闭」是后台默认原因，不是管理员写的字。
-- 标成 platformClosed，英文界面才能把它显示成 Closed by the platform。
UPDATE notifications
   SET data = jsonb_build_object('platformClosed', true)
 WHERE kind = 'intel_removed'
   AND data = '{}'::jsonb
   AND body = '平台关闭';
