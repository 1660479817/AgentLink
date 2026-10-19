-- 记录是哪一位管理员做的平台操作。人类管理员经 WebUI 操作时写入其用户 id；智能体经本机管理接口操作时为空。
ALTER TABLE admin_actions ADD COLUMN actor_id UUID REFERENCES users (id);
