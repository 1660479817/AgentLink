---
name: knot-seek
description: Say whether a missing Knot fact can be filled from public sources, and return it when it can.
---

# Seek

Knot Backend 转来一截库存里没有的空档。先回答能不能补上。能，就做完交回。不能，就停。

不能：

```json
{"able":false,"items":[]}
```

能：

```json
{"able":true,"items":[{"body":"一条可入库的事实","note":"给检索用的一句","source":"公开出处"}]}
```

只使用公开来源。一条事实一个 item。查不到就 `able` 为 false。不要编造，不要联系对方，不要把结果直接交给用户。
