---
name: knot-admin
description: Delete a named Knot post, warn a named account, grant points, mute or unmute an account, grant or revoke honors, set a level, list one account's posts in a time window, change the sponsored rail, and run the daily patrol.
---

# 管理员

Knot Backend 在本机提供管理接口。只从这台机器调用 `http://127.0.0.1:8080`。令牌在工作区文件 `.admin-token`，一行，放进 `Authorization: Bearer`。不要把令牌写进回复。

先读 `.admin-token`。文件没有内容时停下来，说明管理接口还没配好。

## 找人

`GET /api/admin/users?q=`

`q` 是邮箱、称呼、用户 id，或 `label`。返回 `{ users: [{ id, email, displayName, label, level, entitlements, pointsBalance, muted, mutedUntil }] }`。`entitlements` 是权益名称列表。`muted` 为 true 时这个人不能发帖、发 wish、响应 wish。`mutedUntil` 是解除时间；`muted` 为 true 且 `mutedUntil` 为 null，表示直到平台解除。平台账户的 `label` 是 `platform`，不能禁言，也不能改等级和权益。

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

## 发放绩点

`POST /api/admin/points`

```json
{"user":"name@example.com","amount":50,"body":"补偿一次失败的下载。"}
```

`user` 必须只对上一个账户。`amount` 是正整数，一次最多 100000。`body` 不能空，最多 500 字，写主人给出的原因。

成功返回 `{ ok, user, amount, pointsBalance }`。`pointsBalance` 是发放之后的余额。Backend 记一笔 `grant`，并通知这个人「积分已到账」，正文带上数量和原因。再调一次会再发一次。只增加，不扣。巡查不调用这个接口。

## 禁言

`POST /api/admin/mute`

```json
{"user":"name@example.com","until":"7d","body":"请停止骚扰。"}
```

`until` 用 `24h`、`7d`、`2w`，最长 `366d`，从现在算起。`forever` 表示直到以后解除。`body` 不能空，最多 500 字，写主人给出的原因。

成功后这个人不能再提交 `post`、`fastpost`、`wish`、`wishRespond`。阅读、下载和改资料仍可以。通知标题是「已被禁言」。再禁言一次会按新的期限重算。

解除：

`POST /api/admin/unmute`

```json
{"user":"name@example.com","body":"可以恢复发言。"}
```

已经能发言时返回 `{ already: true }`，不再通知。

`label` 为 `platform` 的账户返回 `protected`。期限写错返回 `bad_until`。

## 权益

`POST /api/admin/entitlements`

```json
{"user":"name@example.com","grant":["早期用户"],"revoke":[],"body":"感谢长期供稿。"}
```

`grant` 和 `revoke` 是名称列表，至少有一个名称。名称不能空，最多 20 字，不能含顿号或逗号。一个账户最多 8 个。已经有的不会重复发，没有的收回会被跳过。两边都没有变化时返回 `{ already: true }`。满了返回 `entitlement_full`。名称不合格返回 `bad_entitlement`。

成功返回 `{ ok, granted, revoked, user }`。通知标题是「权益已更新」。这些名称出现在这个人的「我的」里。平台账户返回 `protected`。

## 等级

`POST /api/admin/level`

```json
{"user":"name@example.com","level":2,"body":"供稿稳定。"}
```

`level` 是 1 到 100 的整数。和现在相同返回 `{ already: true }`，不再通知。改了之后通知标题是「等级已更新」。不合格返回 `bad_level`。平台账户返回 `protected`。

禁言、权益、等级和绩点都不在巡查里调用。

## 赞助内容

`GET /api/admin/sponsors` 返回 `{ sponsors: [{ id, title, href, image, caption, source, position }] }`，`position` 小的在前。`image` 没有图时为 null。`caption` 是短说明，`source` 是广告主，可以是空字符串。

加上一条：

`POST /api/admin/sponsors`

```json
{"title":"一则标题","href":"/wish","image":"https://example.com/a.jpg","caption":"一句说明","source":"Knot"}
```

`title` 不能空，最多 80 字。`href` 是以 `/` 开头的站内路径，或 `http`、`https` 地址。`image`、`caption`、`source` 可以不传。`caption` 最多 120 字，`source` 最多 40 字。成功返回 `{ sponsor }`，新的一条排在最后。栏里最多 8 条，满了返回 `sponsor_full`。链接不合格返回 `bad_href`。图片地址不合格返回 `bad_image`。

本机上的一张图先上传，只收 JPEG、PNG、GIF、WebP，8MB 以内：

```bash
curl -sS -H "Authorization: Bearer $TOKEN" -F "file=@/path/to.jpg" \
  "http://127.0.0.1:8080/api/admin/uploads"
```

返回 `{ id, url }`。把 `url` 写进 `image`。

改一条已经在栏里的：

`POST /api/admin/sponsors/<id>`

```json
{"title":"新标题","href":"https://example.com","image":"","caption":"一句说明","source":"Knot"}
```

只改给出的字段，别的不要传。`image` 写成空字符串是拿掉图。什么都不传返回 `bad_body`。

拿下：

`POST /api/admin/sponsors/<id>/remove`

调整先后。`position` 从 1 开始，1 是第一条：

`POST /api/admin/sponsors/<id>/place`

```json
{"position":1}
```

巡查不调用这些接口。

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
curl -sS -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"user":"name@example.com","amount":50,"body":"补偿一次失败的下载。"}' \
  "http://127.0.0.1:8080/api/admin/points"
```

`401` 是令牌不对。`503` 且 `error` 为 `admin_unconfigured` 是 Backend 还没有这把令牌。两种都停，不要重试别的门。
