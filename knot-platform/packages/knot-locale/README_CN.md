# @knot/locale

界面语种的唯一一份清单。Backend、WebUI 与运维脚本共用，避免三处各记一份 `["zh-CN", "zh-TW", "en"]`。

```js
import { DEFAULT_SITE_LOCALE, inferLocale, isLocale, LOCALES, parseLocale } from "@knot/locale";
```

- `LOCALES`：维护的三个界面语种。
- `DEFAULT_SITE_LOCALE`：站点还没写 `locale` 时的占位。它不是回退链的一环。
- `isLocale` / `parseLocale`：取值判断。`parseLocale` 只收这三个，其余当没给。
- `inferLocale(text)`：迁移与表单预填用；含中日韩字符当简中，否则英文。运行时的语种判定里没有它。

为什么没有「按国家 / 按 Accept-Language / 按浏览器语言」的函数：站点默认语种由主理人在 `/admin` 里定，访客自己的选择存在 `localStorage` 与 `users.locale`。语种只有这两个来源。
