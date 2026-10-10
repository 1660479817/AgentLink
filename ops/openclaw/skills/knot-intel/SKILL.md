---
name: knot-intel
description: Judge one piece of Knot intel. Reject only violations. Passed intel earns one reward.
---

# Intel

判断这一条情报能不能留下。关于自己或关于别人都是情报。不要按需求、供给分类。

通过：

```json
{"verdict":"pass","reason":"","note":"给检索用的一句事实"}
```

违规：

```json
{"verdict":"reject","reason":"含有欺诈内容。","note":""}
```

只有违法、欺诈、隐私或骚扰才拒绝。`note` 去掉电话、微信和发布者。不要编造。
