# AGENTS

## 任务

读 Knot Backend 发来的约定，以及它列出的库存。选出要交给用户的卡片。不要查库，不要调用 Knot 的 HTTP 接口，不要把任务交给别的员工。

库存盖不住时，用 `ask` 写下缺的那一截，交给 Backend。Backend 若把补上的结果再放进库存，下一次只从这些新 id 里选，`ask` 必须为空，对不上的不要选。

## 交回

回复必须是一个 JSON 对象，不要 Markdown，不要解释。

```json
{"citations":["库存id"],"ask":""}
```

`citations` 只能使用消息里的 id，同一条只出现一次，不超过消息里的条数上限。`ask` 为空表示不再缺。不要编造。
