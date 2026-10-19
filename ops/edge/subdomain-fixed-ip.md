# xknot 子域：固定公网 IP 直连 runbook

适用：伙伴主机已有稳定公网 IP（或云主机弹性 IP），不需要 SSH 反向隧道。加入流程与域名轴说明见 [xknot.si/docs/JOIN.md](../../xknot.si/docs/JOIN.md) §3.1。NAT / 仅出网场景用 [README.md](./README.md)。

## 目标拓扑

```text
浏览器 ──HTTPS──▶ 伙伴主机（公网 IP）
                     nginx/Caddy 等 → Knot Backend / WebUI
DNS: 某名.xknot.si  A/AAAA → 该公网 IP
```

中枢只按清单探测公网 `healthUrl`；与本项目中枢主机的边缘端口、隧道用户无关。

## 工作人员清单

1. **权利人确认**签发 `某名.xknot.si`（人工；申请通过不会自动出 DNS）。
2. **DNS**：在 xknot.si 区创建 A（及可选 AAAA），指向伙伴**公网** IP。TTL 可先短后长。
3. **不要**指到 `10/8`、`172.16/12`、`192.168/8`、链路本地或云元数据地址。
4. 清单：`instances.json` 的 `url` / `canonical` / `healthUrl` 使用 `https://某名.xknot.si/...`（`healthUrl` 默认 `<url>/api/health`）。
5. 构建：`cd xknot.si && npm run build`，确认 L2 探测对该 `healthUrl` 为 `up` / `degraded`（非内网不可达）。

## 伙伴主机清单

1. 开放 80/443（ACME 与对外 HTTPS）。
2. 为本主机名申请证书（Let’s Encrypt 等），`server_name` 含 `某名.xknot.si`。
3. 反代或同机提供：
   - 静态 WebUI
   - `GET /api/health` → `{ "ok": true, "service": "…", "version": "…" }`
4. 管理面（`/api/admin` 等）按实例自身策略鉴权；固定 IP 模式不经过边缘的 admin 404 规则，需伙伴自己关公网或鉴权。
5. 验证：
   ```bash
   curl -sI https://某名.xknot.si/
   curl -s https://某名.xknot.si/api/health
   ```

## 与隧道模式对照

| 项 | 固定 IP | 边缘 + 隧道 |
|----|---------|-------------|
| DNS 指向 | 伙伴公网 IP | 边缘公网 IP |
| 证书落点 | 伙伴主机 | 边缘 nginx |
| `sshd` Match / `18080` | 不需要 | 需要 |
| 实例常驻隧道 | 不需要 | 需要（`ssh -R`，见 [README.md](./README.md)） |
| 边缘 `wang.xknot.si.conf` 类文件 | 不需要 | 需要（每子域或未来通配） |

## 切换注意

- 从隧道改直连：先改 DNS 到新 IP 并在新主机备好证书与服务，再停实例侧隧道；避免双活抢解析。
- 从直连改隧道：先在边缘备好 conf + 证书 + sshd Match，再改 DNS 到边缘，最后拉起隧道。
- 任一时刻 `healthUrl` 必须是公网 HTTPS；清单不要写局域网地址。
