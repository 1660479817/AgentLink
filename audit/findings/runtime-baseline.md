# 运行时基线（两站实测）

采集时间：2026-10-23
方式：绕开本机 `http_proxy`（`--noproxy '*'`）只发只读 GET，未写任何数据。

> 警告（供后续复测的人）：本机环境变量里有 `http_proxy=https_proxy=http://127.0.0.1:10808`，
> 走代理测公网站会得到大量 8–10 秒超时和 `000`，**这是测量假象，不是线上故障**。
> 第一次探测已经踩过，见本节末尾。

## 版本

| 项 | cpswang.xknot.si | wang.xknot.si |
|---|---|---|
| `/api/health` version | 0.6.0 | 0.6.0 |
| release | `knot-0.6.0-e944be8` | `knot-0.6.0-e944be8` |
| commit | `e944be8`（= 本地 HEAD） | `e944be8`（= 本地 HEAD） |
| DB | 本机 PG14:5440 | bot01 PG16:5433 |
| 后端直连 | 127.0.0.1:8081 | bot01 127.0.0.1:8080 |
| 回源链路 | 入口机 127.0.0.1:18090 → 本机 8081 | 入口机 127.0.0.1:18080 → bot01 8080 |

## 接口实测

| 路径 | cpswang | wang | 判定 |
|---|---|---|---|
| `/api/health` | 200 · 158B | 200 · 155B | 正常 |
| `/api/web/session` | 200 · 661B | 200 · 1008B | 正常，两站会话内容不同属预期 |
| `/api/admin/economy` | 404 · 21B | 404 · 21B | 符合「入口对 `/api/admin` 返回 404」的规则 |
| `/api/admin/posts` | 404 · 21B | 404 · 21B | 同上 |
| `/api/web/submissions` | **401** · 22B | **401** · 22B | **未登录被正确拒绝** |
| `/api/agent/intel`（GET） | 404 · 154B | 404 · 154B | 该路径可能只接受 POST，需 S11 核对契约 |
| `/discover.json` | 200 · 7,996B | 200 · 120,351B | 公网快照可读；两站内容量不同属预期 |
| `/` | 200 · 635B | 200 · 2,284B | SPA 壳，两站 HTML 体积差异需确认是否同一构建 |
| `xknot.si/knot-help` | — | — | 200 · 34,104B |
| `xknot.si/knot-help.md` | — | — | 200 · 22,963B，与文档自述「约 21KB」相符 |

## 直连后端（排除公网链路）

| 项 | 本机 8081 | bot01 8080 |
|---|---|---|
| `/api/health` | 200 · 1ms | 200 · 1ms |
| `/api/web/session` | 200 · 2ms | 200 · 1ms |
| `/api/admin/economy` | **401** · 2ms | **401** · 2ms |
| `/api/admin/posts` | **401** · 1ms | **401** · 2ms |
| `/discover.json` | 200 · 3ms | 200 · 3ms |

后端本地直连对 `/api/admin/*` 返回 401（鉴权生效），公网入口返回 404（nginx 拦截）。
两层行为不同但是设计如此，符合规则文件描述。

## 入口主机（54.169.33.64）

- `127.0.0.1:18080`（→ bot01）与 `127.0.0.1:18090`（→ 本机）均在 `LISTEN`，owner 是 `sshd-session`。
- 从入口机打回源：`18080/api/health` 200 · 0.11s；`18090/api/health` 200 · 0.29s。
- 结论：**两条隧道都活着**。

## 测量假象记录

首次探测未绕代理，结果：

```
cpswang /api/health -> 000 8.004s
cpswang /api/admin/economy -> 404 1.901s     # nginx 直回，不碰后端
wang /api/health -> 000 10.004s
wang /api/admin/posts -> 404 4.966s
```

易被误读为「公网 API 挂了」。实际原因是本机 `http_proxy` 指向 `127.0.0.1:10808`，
代理链路慢，短响应（nginx 404）能挤过去，需要回源的长响应就超时。
绕开代理后全部毫秒级 200/401/404。**不构成线上问题。**

确凿证据（分段计时，走代理时）：

```
cpswang https://cpswang.xknot.si/api/health
  dns=0.000079s connect=0.000000s tls=0.000000s ttfb=0.000000s total=30.006s code=000
wang    https://wang.xknot.si/api/health
  dns=0.000084s connect=0.000405s tls=2.112178s ttfb=2.391647s total=2.392s code=200
```

`connect=0.000000s` 是判据：TCP 连接瞬间完成，说明连的是本机代理端口而不是
新加坡入口机（跨洋不可能 0ms）。随后 TLS 花 2.1 秒，才是代理出口到远端的时间。
**任何后续对公网站的复测都必须加 `--noproxy '*'`，否则测的是代理不是站点。**
