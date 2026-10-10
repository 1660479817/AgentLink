# Knot WebUI 设计核对

对照 [KNOT_WEB_UI.md](./KNOT_WEB_UI.md)。最后更新：2026-10-10。

---

## 1. 已确认的产品决策

（见 [KNOT_WEB_UI.md](./KNOT_WEB_UI.md) 与历次对话记录。）

---

## 2. 实现状态

| 项 | 状态 |
|----|------|
| 单页首页 + 搜索 | ✅ |
| 顶栏通知 / 消息 | ✅ API + WebUI |
| 信息卡片、匿名类型 | ✅ |
| 图片上传 + 表达绑定 | ✅ `POST /uploads`、`imageIds` |
| 不违规即公开；仅 `violation` 打回 + 通知 | ✅ `review.js` |
| 高价值情报归类 `intel_classes`；归类后才记情报积分 | ✅ |
| 我的 · 积分 | ✅ `GET /points` |
| 我的信息 | ✅ `/mine/submissions` |
| 撮合 match 行 + 消息 | ✅ |
| 对接 connect + 扣积分 | ✅ |
| 公域按原样展示：纯文字、纯图片或图文；不展示发布者 | ✅ |

Process 由 Knot Backend 拉起 `knot-process`：不违规即公开，高价值情报写入 `intel_classes`。撮合逻辑仍为 `fits()` 文本匹配。搜索会带上归类后的类别和事实。

---

## 3. 交互细节（已确认）

- 通知已读后 **保留在列表**；`POST /notifications/read` 只清角标。
- 对接一条 match **不** 使其它 match 失效。

---

## 4. API 索引

见 [KNOT_WEB_API.md](./KNOT_WEB_API.md)。
