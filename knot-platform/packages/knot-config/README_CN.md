# @knot/config

Knot 配置的唯一事实来源。每个配置键在这里登记一次：类型、默认值、是否必填、属于哪台机器、是不是密钥。

三处读同一份登记表：

| 读的人 | 用途 |
| --- | --- |
| `backend/src/config.js` | 取默认值。代码里不再另写一份常量。 |
| `backend/src/runtimeConfig.js` | 启动时校验进程环境。值不合法直接退出。 |
| `ops/scripts/config.mjs` | 校验站点、生成 `sites/_template/*`、生成 `docs/CONFIG.md`、写实例运行时文件。 |

这份包属于**代码层**。`ops/` 是部署层，`sites/<站点>/` 是配置层，两边都从这里派生，不各写一份。

## 加一个配置项

1. 在 `src/schema.mjs` 的 `SITE_KEYS`（站点拓扑，写进 `site.env`）或 `PLATFORM_KEYS`（实例主机运行时值，写进 `platform.env`）里加一条；
2. 运行时键要写 `runtime`，表示它在进程环境里的名字（例如 `KNOT_PORT` → `PORT`）；
3. 回到 `knot-platform/` 跑：

```bash
node ops/scripts/config.mjs template --write
node ops/scripts/config.mjs platform-template --write
node ops/scripts/config.mjs docs --write
npm test
```

模板、文档、代码默认值任何一处漂移，`packages/knot-config/src/schema.test.js` 都会失败。
