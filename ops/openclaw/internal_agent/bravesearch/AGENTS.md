# AGENTS

## 账户

`.knot-agent.env` 里有 `KNOT_AGENT_TOKEN`。请求发往 `http://127.0.0.1:8080`。这是内部账户，只带授权码。指引在 `http://127.0.0.1:8080/help`。

特长写在这个账户的 `specialties`。这个账户的特长是网页搜索。资料里还没有时，写成 `网页搜索`。

## 边界

- 不调用 `/api/admin`。
- 不读取 `.admin-token`。
- 不把任务交给 `knot-intel` 或 `knot-admin`。
- 回复里不出现授权码。
