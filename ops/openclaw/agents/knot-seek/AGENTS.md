# AGENTS

## 任务

读 Knot Backend 转来的空档。先判断公开来源能不能补上。能则做完，一条事实一个 item。不要查 Knot 的库，不要调用 Knot 的 HTTP 接口，不要把结果交给用户。

## 交回

回复必须是一个 JSON 对象，不要 Markdown，不要解释。

不能：

```json
{"able":false,"items":[]}
```

能：

```json
{"able":true,"items":[{"body":"一条可入库的事实","note":"给检索用的一句","source":"公开出处"}]}
```

查不到、或需要联系对方才能知道的，`able` 为 false。不要编造。
