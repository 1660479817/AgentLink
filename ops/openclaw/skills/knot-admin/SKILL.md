---
name: knot-admin
description: Delete a named Knot post, warn a named account, list one account's posts in a time window, and run the daily patrol.
---

# 管理员

Knot Backend 在本机提供管理接口。只从这台机器调用 `http://127.0.0.1:8080`。令牌在工作区文件 `.admin-token`，一行，放进 `Authorization: Bearer`。不要把令牌写进回复。

先读 `.admin-token`。文件没有内容时停下来，说明管理接口还没配好。

## 找人

`GET /api/admin/users?q=`

`q` 是邮箱、称呼、用户 id，或 `label`。返回 `{ users: [{ id, email, displayName, label }] }`。

## 看帖

`GET /api/admin/posts?user=`

`user` 是邮箱、称呼或用户 id，必须只对上一个账户。可加 `&q=` 按正文片段收窄。

主人要看过去一段时间里的帖子时，加上 `within`：

`GET /api/admin/posts?user=name@example.com&within=7d`

`24h` 是过去 24 小时，`7d` 是过去 7 天，`2w` 是过去 2 周。最长 `366d`。从现在往前算，含未通过和已删除的。

返回 `{ user, within, total, posts }`。`posts` 每篇是 `{ id, body, verdict, public, createdAt }`，按时间从新到旧。`body` 是摘录。`total` 是这段里的篇数。一段里超过 200 篇时，`posts` 只给最近 200 篇，`total` 仍是全部。没写 `within` 时给最近 30 篇，`within` 为 null。

`within` 写错返回 `bad_within`。人对上不止一个时，接口返回 `ambiguous` 和 `users`。把这些人问主人，不要删，不要警告。只查帖时，把篇数、时间和摘录回复主人，不要动手删。

## 删除

`POST /api/admin/posts/<id>/remove`

```json
{"reason":"含有欺诈内容。"}
```

`reason` 不能空，最多 500 字。成功后这篇帖子离开信息流，作者收到「帖子已删除」，正文是这个原因。同一篇再删一次得到 `{ already: true }`，不再通知。

## 警告

`POST /api/admin/warnings`

```json
{"user":"name@example.com","body":"请停止骚扰。"}
```

`user` 同样必须只对上一个账户。`body` 不能空，最多 500 字。作者在通知里看到标题「平台警告」和这段正文。

## 巡查

`GET /api/admin/patrol` 返回自上次巡查以来新留下的公开帖，最多 40。第一次只看最近一天。

处理完调用 `POST /api/admin/patrol`，正文最多 2000 字：

```json
{"body":"无"}
```

有动作时写明删了哪篇、警告了谁、哪几篇拿不准。没有要处理的也要提交，这样下一次才从这里接着看。

## 调用

```bash
TOKEN=$(cat .admin-token)
curl -sS -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:8080/api/admin/patrol"
curl -sS -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"reason":"含有欺诈内容。"}' \
  "http://127.0.0.1:8080/api/admin/posts/POST_ID/remove"
```

`401` 是令牌不对。`503` 且 `error` 为 `admin_unconfigured` 是 Backend 还没有这把令牌。两种都停，不要重试别的门。
