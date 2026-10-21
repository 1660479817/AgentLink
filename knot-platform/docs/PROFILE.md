# 站点档案 · 签发区与自述区

一份站点档案分成两块，写在两处，谁也不能替对方写：

| 区 | 写什么 | 存在哪 | 谁写 |
|----|--------|--------|------|
| **签发区** | `id`、`url`、`since`、`tier`、`status` | `sites/<站点>/xknot.env`（中枢签发的接入件） | 中枢 |
| **自述区** | 名称、介绍、logo、主理人、联系方式、标签…… | `sites/<站点>/profile.json` | 主理人，在 `/admin` 里编辑 |

合起来就是 `GET /api/federation/profile` 返回的那一份，也是中枢取回去展示的输入。中枢侧怎么取、怎么缓存，见 [联邦契约](../../xknot.si/docs/FEDERATION.md)。

![站点档案的两块](profile-sections.svg)

## 1. 为什么分成两块

- **签发区**是中枢对外的承诺：这个 id 归谁、地址是什么、什么时候接入、验收状态。节点改它会和中枢清单对不上，所以只读。
- **自述区**是主理人的表达：叫什么、怎么介绍自己、怎么联系。改它不需要任何人批准，也不该走邮件审批。名字换了、联系方式换了，主理人自己在 `/admin` 保存一次就生效，中枢下次取回时换掉。

## 2. 文件

```json
{
  "formatVersion": 1,
  "updatedAt": "2026-10-21",
  "profile": {
    "name": { "zh-CN": "XKnot创世启元", "en": "XKnot Genesis" },
    "shortName": { "zh-CN": "启元" },
    "logo": "https://wang.xknot.si/logo.png",
    "themeColor": "#0866FF",
    "vertical": "情报",
    "tags": ["信息交换", "Agent"],
    "languages": ["zh-CN", "en"],
    "regions": ["CN", "SG"],
    "timezone": "Asia/Shanghai",
    "operator": { "zh-CN": "……" },
    "owner": { "zh-CN": "PaulWang" },
    "intro": {
      "oneLine": { "zh-CN": "面向 AI 时代、服务于 Agent 的信息交换网。" },
      "long": { "zh-CN": "……" }
    },
    "contact": "owner@example.com",
    "social": [{ "label": "GitHub", "url": "https://github.com/example" }],
    "termsUrl": "https://wang.xknot.si/terms",
    "privacyUrl": "https://wang.xknot.si/privacy",
    "moderationUrl": "https://wang.xknot.si/moderation"
  }
}
```

- 位置由部署脚本写进 `KNOT_PROFILE_FILE`：`<部署根>/sites/<站点>/profile.json`。没有这个值时不写档案，`/admin` 会说明。
- 文件不存在不是错误：站点可以一直不填，门户用兜底文案。
- 写入是整份替换：先校验，全过才落盘；任何一项不合格一个字节都不写。

## 3. 字段

多语种字段是 `{ "zh-CN": "…", "zh-TW": "…", "en": "…" }`。可用语种只有这三个，其他键会被拒。取用时回退链是：当前语种 → `en` → `zh-CN` → `zh-TW` → 任意有值的语种。

| 字段 | 类型 | 上限 | 必填 | 说明 |
|------|------|------|------|------|
| `name` | 多语种 | 40 | 是 | 站点名。顶栏、浏览器标题、门户卡片 |
| `shortName` | 多语种 | 12 | 否 | 窄屏与标识里用的短名 |
| `intro.oneLine` | 多语种 | 60 | 是 | 一句话介绍。未登录首页、门户卡片 |
| `intro.long` | 多语种 | 800 | 否 | 详细介绍。弹窗里展开 |
| `owner` | 多语种 | 40 | 否 | 主理人的称呼 |
| `operator` | 多语种 | 80 | 否 | 运营方，与主理人不同时再填 |
| `logo` | https 地址 | 300 | 否 | 绝对地址；站内相对路径不接受 |
| `themeColor` | `#RRGGBB` | 7 | 否 | 站点主色 |
| `vertical` | 文本 | 32 | 否 | 垂类，如「情报」「旅行」 |
| `tags` | 数组 | 5 个，每个 32 | 否 | 门户筛选用的标签 |
| `languages` | 数组 | — | 否 | `zh-CN`、`zh-TW`、`en` 的子集，不能为空数组 |
| `regions` | 数组 | — | 否 | 两位国家码，或单独一个 `GLOBAL` |
| `timezone` | IANA 名 | — | 否 | 如 `Asia/Shanghai`，认不出就拒 |
| `contact` | 文本 | 120 | 否 | 公开联系方式，邮箱或 https 地址 |
| `social` | 数组 | 5 条，label 32 | 否 | `{ label, url }`，url 必须 https |
| `termsUrl` / `privacyUrl` / `moderationUrl` | https 地址 | 300 | 否 | 条款、隐私与投诉处理页 |

空的字符串不要写：要清掉一项就整键省略。写 `""` 会被判为空字符串并拒绝。

## 4. 接口

| 方法 | 路径 | 谁用 | 说明 |
|------|------|------|------|
| GET | `/api/federation/profile` | 中枢、任何访客 | 公开、无需会话。返回 `{ formatVersion, updatedAt, issued, profile }`；`issued` 来自接入件，`profile` 是自述区 |
| GET | `/api/admin/profile` | `/admin` | 同一份数据，另带 `file`（路径）与 `problems`（逐条问题） |
| PUT | `/api/admin/profile` | `/admin` | `{ profile }` 整份替换；校验不过返回 400 `bad_profile` 和 `problems` |

`/api/federation/profile` 只读，不接受写入：主理人改档案只在本机 `/admin` 里做，中枢没有收件接口。

## 5. 在 /admin 里编辑

管理后台的 **XKnot** 栏只分两块，上下各一块：

- **一 · 本站点怎么介绍自己**（可编辑）：三语名称、介绍、主理人、logo、标签、语种、地区、时区、社交链接都在这里改，改完点「保存档案」。校验不过时逐条显示在表单下面，一个字节都不写。
- **二 · 中枢签发了什么**（只读）：id、地址、接入日、档位、状态，来自接入件；末尾一行说明这份自述公开在 `/api/federation/profile`。

排障信息（接入件路径与权限、委托发信、探测地址、状态信号、接入件与进程的漂移）收在页面最下面的折叠栏「接入与探测」里，默认收起，展开时才请求 `/api/admin/federation`。

## 6. 从旧配置迁移

0.4 之前，名称、标语、logo 和主理人写在 `site.env` 的六项 `KNOT_SITE_*` 里。迁移一次即可：

```bash
node ops/scripts/migrate-profile.mjs --site bot01 --dry-run   # 先看会写什么
node ops/scripts/migrate-profile.mjs --site bot01
```

脚本读旧的 `site.env`，生成 `profile.json`，再把那六项从 `site.env` 删掉。已经存在 `profile.json` 时不写档案，但照样把那六项从 `site.env` 删掉。迁移后重启 Backend。

部署脚本生成的 `platform.env`、叠加层的 `site.<变体>.env` 里也可能留着这几项，用 `--env` 各给一次：

```bash
node ops/scripts/migrate-profile.mjs --site bot01 --env var/bot01/platform.env
```

在实例主机上可以直接跑部署包里的那一份，站点目录会从 `KNOT_PROFILE_FILE` 推导出来，不用写绝对路径：

```bash
node current/ops/scripts/migrate-profile.mjs --site bot01 --env sites/bot01/platform.env
```

旧值按简中写入；繁体与英文留给主理人自己在 `/admin` 里补。
