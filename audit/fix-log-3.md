# 第三批修复：S14-01 音频魔数 + 远端部署 $5 越界

第二批（`fix-log-2.md`）之后还剩一个 P0 挂在「部分」里：S14-01 的音频上传只按
「扩展名 + 客户端声明」归一 MIME，不做内容复核。另外首次远端部署时撞上一个
c8ebca4 引入后从未被踩过的 `push-deploy.sh` 空参数 bug。这一批把两处都收口。

## 1. 音频魔数复核（S14-01，P0）

**发现**：`storeUploadedFile` 对 `kind: "audio"` 只调 `safeAudioMime(声明, 文件名)`——
按扩展名归一。于是「文件名 `.mp3` + `Content-Type: text/html` + HTML 正文」能过
multer 初筛（`isAudioUpload` 认扩展名），进库时被归一成 `audio/mpeg`，再被
`GET /api/web/uploads/:id` 按 `audio/*` 内联回源。图像路径早就用 sharp 按内容解码
（`readImageMeta`），音频路径却一直只看名字。

**修在哪**：`backend/src/uploadStore.js`。

- 新增 `audioMimeFromHead`：按文件头魔数认 MP3（ID3 / MPEG 帧同步）、Ogg、FLAC、
  WAV（RIFF…WAVE）、M4A（ftyp）、AAC（ADTS 同步字）、WMA（ASF 头），认得出按内容给
  MIME，认不出返回 null。
- 新增 `readAudioMeta`：只读文件头 16 字节（`openSync`/`readSync`），不把整份音频
  载进内存。
- `storeUploadedFile` 的音频分支改成「魔数认不出就 `bad_audio` 并删文件」，认出的
  MIME 为最终类型——声明与扩展名彻底退到初筛。
- 删掉 `safeAudioMime` 与 `AUDIO_MIME_BY_EXT`：只剩测试在引用的死代码。

**回归测试**：`uploadMime.test.js` 重写为魔数用例（9 种头、非音频头一律 null）；
`uploadStore.test.js` 加「HTML 冒名 mp3 被拒」与「真音频按内容定类型（声明 text/html
盖不掉）」两条。全仓 862 通过。

## 2. 远端部署不带 --runtime 时 $5 越界

**发现**：`push-deploy.sh` 远端段 `set -u`，`runtime="$5"`。不带 `--runtime` 时
`${RUNTIME_ARG:-}` 展开成空串，ssh 拼远程命令时末尾空参数被丢掉，`$5` 直接 unbound。
首次远端部署（bot01）停在 `bash: line 6: $5: unbound variable`——包已传、迁移没跑、
`current` 没切。c8ebca4 引入后从未被远端部署路径踩到。

**修在哪**：`ops/scripts/push-deploy.sh`，`runtime="${5:-}"`，把「没传」和「传了空串」
都按空处理。

## 部署与端到端

- `push-deploy.sh --site bot01` 成功后，实例主机跑到 0.6.0（`4303f6d`），迁移
  `002_notification_data` 与 `003_login_guard_and_idempotency` 都落库
  （`migrate.js --status`：已执行 3 个）。
- 登录码枚举（S10-01）：同一地址错 5 次后第 6 次 429 + `Retry-After: 900`；
  `login_failures` 表里 `(email, '')` 记到 5、`(email, ip)` 已锁。
- 发放幂等（S08-01）：`POST /api/admin/points` 带 `requestId` 发一次，同键重试返回
  `duplicate:true` 不再加钱；`admin_actions` 与 `point_ledger` 各只有一行。
