# Phase 0

本阶段证明 [KNOT_PROJECT_PLAN.md](./KNOT_PROJECT_PLAN.md) 里的回路能够跑通一次。

人或 Personal Agent 说出需要什么、能供应什么。Knot Backend 保存状态，按状态拉起 Knot Agent，员工写回。反馈从进来的那扇门出去。

---

## 1. 本阶段要有的组成

| 组成 | 位置 | 本阶段交付 |
|------|------|------------|
| **Knot WebUI** | AgentLink 外 | 人建立会话，表达需求或供给，看到回到这扇门的反馈，并能委托 Personal Agent |
| **Agent API** | AgentLink 内 | Personal Agent 提交需求或供给，并读回反馈 |
| **Knot Backend** | AgentLink 内 | 保存状态，按状态拉起 Knot Agent，从进门送出反馈 |
| **数据库** | AgentLink 内 | 只由 Knot Backend 访问 |
| **Knot Agent** | AgentLink 内 | Process、Source、Match、Feedback 都能被拉起并写回 |

Knot WebUI 的页面见 [KNOT_WEB_UI.md](./KNOT_WEB_UI.md)。它调用 Backend 的契约见 [KNOT_WEB_API.md](./KNOT_WEB_API.md)。Agent API 见项目规划第 8 节。

---

## 2. 状态

Knot Backend 至少保存这些状态：

| 状态 | 内容 |
|------|------|
| 当事人 | 人，或被委托的 Personal Agent |
| 表达 | 需求或供给，以及进门是 Knot WebUI 还是 Agent API |
| 可撮合信息 | Process 写回。不违规即公开 |
| 高价值情报 | Process 归类后的类别、事实和依据 |
| 寻源结果 | Source 写回 |
| 配对 | Match 写回 |
| 待送出的反馈 | Feedback 写回；Backend 按进门送出 |

Knot WebUI、Agent API 和 Knot Agent 经过 Knot Backend 读写这些状态。

---

## 3. 按状态拉起

人在 Knot WebUI 提交一条需求，或一条供给。请求进入 Knot Backend 并写入数据库。Personal Agent 经 Agent API 提交时，进入同一个 Backend。

Backend 看当前状态，拉起其中一类 Knot Agent：

| 状态 | 拉起 | 写回 |
|------|------|------|
| 有一条新的表达 | **Process** | 可展示、可撮合的信息；高价值情报另归类 |
| 需求还没有供给 | **Source** | 收集、寻找，或者建议 |
| 需求和对得上的供给都在 | **Match** | 配对 |
| 已经有要送回去的结果 | **Feedback** | 待送出的反馈 |

每次拉起都由 Backend 发起，员工只写回 Backend。四类之间不互相调用。

Feedback 写回之后，Backend 从这条表达进来的那扇门送出。从 Knot WebUI 进来的，人在 Knot WebUI 看到。从 Agent API 进来的，Personal Agent 从 Agent API 读到。

---

## 4. 委托

人在 Knot WebUI 委托自己的 Personal Agent。Knot Backend 签发凭证。该凭证只在 Agent API 上使用。

Knot WebUI 不代替 Personal Agent 调用 Agent API。

---

## 5. 验收

- [ ] 人从 Knot WebUI 提交需求，反馈出现在 Knot WebUI
- [ ] 人从 Knot WebUI 提交供给，反馈出现在 Knot WebUI
- [ ] Personal Agent 从 Agent API 提交需求或供给，反馈从 Agent API 返回
- [ ] 数据库的读写只出现在 Knot Backend
- [ ] 供给已经存在时，Backend 拉起 Match，Match 写回配对
- [ ] 供给不存在时，Backend 拉起 Source，Source 写回收集、寻找或建议
- [ ] Feedback 写回 Backend，送出由 Backend 按进门完成
- [ ] 四类 Knot Agent 都能单独被状态拉起
