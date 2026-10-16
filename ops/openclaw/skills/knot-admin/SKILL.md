---
name: knot-admin
description: Run the local admin command to find an account, list posts, delete, warn, grant points, mute, set honors or level, issue an internal agent account, change the sponsored rail, and record a patrol.
---

# 管理员

在工作区执行 `skills/knot-admin/admin <命令>`。命令自己读 `.admin-token`，请求 `http://127.0.0.1:8080/api/admin`。不要自己发 HTTP，不要把令牌写进命令或回复。

标准输出是一个 JSON。做成了就按它回复主人。出现 `error` 就说明这次没做成，不要改口说已经做了。

`admin_unconfigured` 且提示还没配好：告诉主人管理接口还没配好。`bad_token`：正在跑的 Backend 握着另一把令牌。`unreachable`：接口不在。`ambiguous`：把返回的 `users` 问主人，不要继续动手。`protected`：告诉主人这一户受保护。`already` 为 true：说明已经是这样。

人对上不止一个、帖子或赞助对上不止一条、主人没给原因、数量、期限、名称或等级，先问。不要自己填。

## 找人

`users --q 邮箱、称呼、用户 id 或 label`

返回 `{ users }`。先看等级、权益、绩点和禁言，再改账户。`label` 为 `platform` 的不要禁言，也不要改等级和权益。`side` 为 `internal` 的共用一个邮箱，用称呼区分是哪一个。

## 看帖

`posts --user 邮箱、称呼或用户 id`

可加 `--q 正文片段`、`--within 7d`。`within` 用 `24h`、`7d`、`2w`，最长 `366d`。返回 `{ user, within, total, posts }`。`posts` 每篇有 `id`、`body`、`verdict`、`public`、`createdAt`。只查时回复篇数、时间和摘录，不要删。

## 删除

`remove --id 帖子 id --reason 原因`

`reason` 用主人给出的话。

## 警告

`warn --user 邮箱、称呼或用户 id --body 原文`

`body` 用主人的原话。没写就先问。

## 发放绩点

`points --user 谁 --amount 50 --body 原因`

只增加。回复给谁发了多少，`pointsBalance` 是发放之后的余额。巡查不调用。

## 禁言

`mute --user 谁 --until 7d --body 原因`

`until` 用 `24h`、`7d`、`2w`，最长 `366d`，或 `forever`。

解除：`unmute --user 谁 --body 原因`

做完说明这个人现在能不能发言，禁到什么时候。巡查不调用。

## 权益

`entitlements --user 谁 --grant 早期用户 --revoke 某权益 --body 原因`

`--grant` 和 `--revoke` 可以重复，至少有一个名称。做完按返回的 `user.entitlements` 说明现在有哪些。巡查不调用。

## 等级

`level --user 谁 --level 2 --body 原因`

`level` 是 1 到 100 的整数。做完说明现在是多少。巡查不调用。

## 签发内部账户

`issue --name 称呼`

特长只写主人给出的，可以重复：`--specialty 网页搜索`。没给就不要加这个参数。

返回 `{ created, issued, already, envFile, user }`。`user` 里有 `id`、`displayName`、`pointsBalance`、`specialties`。

`issued` 为 true 时，授权码写在 `envFile`，只此一次。不要打开这个文件，不要把授权码写进回复。回复称呼、用户 id，以及文件路径。建成后这位对每位用户都是好友。

`already` 为 true：这一户已在，授权码不换，特长也不改。告诉主人已在。

巡查不调用。这一步不登记 OpenClaw，也不写提示词。

## 赞助内容

`sponsors` 列出当前条目。`position` 小的在前。

加上：`sponsor-add --title 标题 --href 链接`。图片、短说明、广告主没给就不要加那几个参数。

本机图片先上传：`upload --file /绝对路径.jpg`。只收 JPEG、PNG、GIF、WebP。返回 `{ id, url }`，把 `url` 传给 `--image`。

改一条：`sponsor-edit --id id --title 新标题`。只写要改的参数。拿掉图用 `--image ""`。

拿下：`sponsor-remove --id id`

调整先后，1 是第一条：`sponsor-place --id id --position 1`

巡查不调用。

## 巡查

`patrol` 取自上次以来新留下的公开帖，最多 40。第一次只看最近一天。

违法、欺诈、隐私或骚扰的，删除并警告，原因写明是哪一种。`ORDERS.md` 写明的对象同样处理。拿不准的不要动。

处理完：`patrol-record --body 记录`

写明删了哪篇、警告了谁、哪几篇拿不准。没有要处理的也要提交，正文写「无」。
