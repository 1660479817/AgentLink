# Knot Web UI 审核报告（2026-10）

> 对照 [KNOT_WEB_UI.md](./KNOT_WEB_UI.md)、[KNOT_WEB_API.md](./KNOT_WEB_API.md) 与 Vercel Web Interface Guidelines。

## 完善度总览

| 维度 | 完成度 | 说明 |
|------|:------:|------|
| 三栏 IA + 路由 | **85%** | `/` `/plaza` `/mine` ✓；Agent 仍独立 `/agent`（可接受，与「我的·设置」一致） |
| 快照 + 缓冲池 | **90%** | 展示走 snapshot；广场搜索独立 pull ✓；**缺** URL 同步 `q`（已补） |
| 首页叙事 | **70%** | Hero + 指标 + 预览 ✓；**缺** 人/助理分工、三步引导（已补）；已登录欢迎区（已补） |
| 信息广场 | **75%** | 列表/需求/交换 ✓；**缺** 手动刷新、发布 CTA、卡片详情页（Phase 0 可链 API 占位） |
| 我的 | **65%** | 上传/卡片/jobs ✓；**缺** Tab IA、交换区、未登录落地页（已补 guest） |
| i18n + SVG | **80%** | 主流程 ✓；Agent 页、部分 aria（已补） |
| 视觉 / a11y | **60%** | 通用 system-ui；**缺** focus、skip、Intl 格式、active 导航（已补一轮） |

## 指南审计摘要（修复前）

| 文件 | 问题 |
|------|------|
| `Login.jsx` | 邮箱/验证码缺 `name`、`autoComplete`；验证码应 `spellCheck={false}` |
| `Plaza.jsx` | 搜索无 URL 深链；缺 `aria-live` 反馈刷新 |
| `App.jsx` | 无 skip link / `<main>`；导航无当前页指示 |
| `AgentTokens.jsx` | 硬编码中文；标签 input 无 `<label>` |
| `styles.css` | 无 `:focus-visible`；统计数字非 tabular-nums |
| `Mine.jsx` | 未登录直接跳登录，不符合 §6「说明 + 注册引导」 |
| `Home.jsx` | 已登录仍只见匿名叙事块 |

## 设计方向（优化后）

- **气质**：工业可信 + 克制（信息交换网，非 SaaS 渐变风）。
- **色**：深 Teal 主色 + 暖灰背景，CSS 变量统一。
- **字体**：Noto Sans SC + 中文排版；数字 `tabular-nums`。
- **动效**：仅 `prefers-reduced-motion` 友好过渡，不做花哨动画。

## 后续建议（未在本轮编码）

1. 卡片详情页 `/cards/:id`（只读披露）
2. 广场 `plaza.cursor` 分页与 URL
3. `home.copy` 平台下发 CMS 文案
4. 我的 · 交换 Tab（第一期）
5. 列表 >50 条时 `content-visibility` / 虚拟列表
