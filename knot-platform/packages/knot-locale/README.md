# @knot/locale

The single list of UI locales. Shared by Backend, WebUI, and ops scripts, to avoid three places each keeping `["zh-CN", "zh-TW", "en"]`.

```js
import { DEFAULT_SITE_LOCALE, inferLocale, isLocale, LOCALES, parseLocale } from "@knot/locale";
```

- `LOCALES`: the three maintained UI locales.
- `DEFAULT_SITE_LOCALE`: the placeholder when a site hasn't written `locale` yet. It is not part of a fallback chain.
- `isLocale` / `parseLocale`: value checks. `parseLocale` accepts only these three; anything else is treated as not given.
- `inferLocale(text)`: used by migration and form prefill; CJK characters mean simplified Chinese, otherwise English. Runtime locale resolution does not use it.

Why there is no "by country / by Accept-Language / by browser language" function: the site default locale is set by the owner in `/admin`, and the visitor's own choice is stored in `localStorage` and `users.locale`. Those two are the only sources of locale.
