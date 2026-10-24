# Site profile · issued zone and self-description zone

One site profile is split into two zones, written in two places, and neither may write for the other:

| Zone | What it holds | Where it lives | Who writes it |
|----|--------|--------|------|
| **Issued zone** | `id`, `url`, `since`, `tier`, `status` | `sites/<site>/xknot.env` (the hub-issued onboarding file) | the hub |
| **Self-description zone** | name, tagline, intro, logo, owner, contact, region, timezone, tags | `sites/<site>/profile.json` | the owner, edited in `/admin` |

Together they are what `GET /api/federation/profile` returns, and the input the hub fetches for display. How the hub fetches and caches it is in [the federation contract](../../xknot.si/docs/FEDERATION.md).

![The two zones of a site profile](profile-sections.svg)

## 1. Why two zones

- The **issued zone** is the hub's commitment to the outside: which id belongs to whom, what the address is, when it joined, its acceptance status. A node changing it would mismatch the hub's roster, so it is read-only.
- The **self-description zone** is the owner's expression: what it's called, how it introduces itself, how to be reached. Changing it needs no one's approval and should not go through email review. When the name or contact changes, the owner saves once in `/admin` and it takes effect; the hub swaps it in on the next fetch.

## 2. File

```json
{
  "formatVersion": 2,
  "updatedAt": "2026-10-21",
  "site": {
    "name": "XKnot创世启元",
    "locale": "zh-CN",
    "tagline": "面向 AI 时代、服务于 Agent 的信息交换网。",
    "intro": "一个站点，收发一手情报……",
    "logo": "https://wang.xknot.si/logo.png",
    "owner": "PaulWang",
    "contact": "owner@example.com",
    "region": "CN",
    "timezone": "Asia/Shanghai",
    "tags": ["信息交换", "Agent"]
  }
}
```

- The location is written into `KNOT_PROFILE_FILE` by the deploy script: `<deploy root>/sites/<site>/profile.json`. Without this value no profile is written, and `/admin` explains it.
- A missing file is not an error: a site can stay unfilled forever, using fallback copy locally, while the portal shows only the id.
- Writes replace the whole file: validate first, write only if everything passes; if any field fails, not a single byte is written.

## 3. Fields

Ten fields, all flat values, **no multilingual copy mapping**: whatever the owner writes is what the site displays and what the hub fetches verbatim. The owner decides the language; the system does not compromise, translate, or fall back. The only locale field is `locale`: it describes not the copy but the **interface** — what language the WebUI uses on a visitor's first open.

| Field | Type | Limit | Required | Notes |
|------|------|------|------|------|
| `name` | string | 40 | yes | Site name. Top bar, browser title, portal card |
| `locale` | `zh-CN` / `zh-TW` / `en` | — | yes (enforced in `/admin`) | The site default UI language. A visitor's own choice wins when they've chosen one; otherwise this. Also the language of communication emails to the hub |
| `tagline` | string | 60 | no | One-line intro. Logged-out home, portal card |
| `intro` | string | 800 | no | Full intro, expanded after opening the site intro |
| `logo` | https URL | 300 | no | Absolute address; in-site relative paths are not accepted |
| `owner` | string | 40 | no | The owner's name |
| `contact` | string | 120 | no | Public contact, email or https address |
| `region` | two-letter country code or `GLOBAL` | 2 | no | The portal groups by it; lowercase is uppercased |
| `timezone` | IANA name | 40 | no | e.g. `Asia/Shanghai`; unrecognized is rejected |
| `tags` | string array | 9 items, 16 each | no | Free text, not translated, not sorted, deduped ignoring case |

`region` and `timezone` are used only on the hub portal: the local site does not show the region, and timezone is only for the local clock on the portal card. `region` is **where the machine is**; it does not decide the interface language or the copy language. `tags` likewise appear only on the portal card and in filtering.

`locale` is optional at the interface layer: old profiles without it must still be readable and fetchable, defaulting to `zh-CN`; `/admin` always saves with it, so newly written profiles always have it. A wrong value (`ja`, or anything other than an empty string) rejects the whole profile.

Do not write empty strings: to clear a field, omit the whole key. Unknown keys are rejected — the old `shortName`, `operator`, `vertical`, `themeColor`, `languages`, `regions`, `social`, `termsUrl`, `privacyUrl`, `moderationUrl` have all been removed.

## 4. Interfaces

| Method | Path | Who | Notes |
|------|------|------|------|
| GET | `/api/federation/profile` | hub, any visitor | Public, no session. Returns `{ formatVersion, issued, site, updatedAt }`; the self-description zone is verbatim inside `site`, same shape as `profile.json`'s `site` |
| GET | `/api/admin/profile` | `/admin` | The same data, plus `file` (path) and `problems` (per-field) |
| PUT | `/api/admin/profile` | `/admin` | `{ site }` full replace; on success returns the same view as GET (with `issued`); on validation failure returns 400 `bad_profile` and `problems`; with no site directory returns 503 `profile_unconfigured` |
| GET | `/api/admin/xknot/subdomain?label=` | `/admin` | Forwards the label to the hub's `GET /api/subdomains/check`, returns `available`, `reason`, and suggestions |
| POST | `/api/admin/xknot/apply` | `/admin` | Hands the self-description and contact email to the hub's `POST /api/applications`; the hub's status codes and `fields` come back verbatim. On success also `key`: `{ delivered, created, error }`, whether the tunnel public key handed over was accepted |
| GET | `/api/admin/xknot/application` | `/admin` | Local ledger: the submitted application's number, case link, status, and time; `application` is `null` when there is no record |

After `POST /api/admin/xknot/apply` succeeds, these four items are written into `join.json` next to `profile.json` (mode `600`). On acceptance, the same request generates (or reuses) a tunnel key and hands the public key to the case page; if this step fails it does not roll back the application — the response's `key.delivered` is `false` and `key.error` says whether generation failed or the hub rejected it. The case link is itself the capability credential; it never enters version control or the release package. Email is only a sync notification; after refreshing the page you can still open progress from the "Join XKnot" card.

`defaultLocale` in `/api/web/session` is `site.locale`, `zh-CN` when the profile lacks it; `brand` is a subset of `site` (name, tagline, intro, logo, owner, contact) — the local WebUI uses only these six.

`/api/federation/profile` is read-only and accepts no writes: the owner changes the profile only in the local `/admin`; the hub has no intake endpoint.

The entry home page's `title`, `description`, Open Graph, and `<noscript>` intro also come from this profile, but they are **static HTML generated when the entry is pushed**, not computed per request: after changing the profile, re-push the entry once (`push-entry.sh`) to swap them. Generation rules are in [`ops/entry/README.md`](../ops/entry/README.md).

## 5. Editing in /admin

The admin console's **XKnot** tab has three blocks:

- **1 · How this site introduces itself** (editable): ten fields, name required, the rest optional; "default locale" is a dropdown with only simplified Chinese, traditional Chinese, and English. Finish with "Save profile". Validation failures are shown one by one under the form, and not a single byte is written. Region, timezone, and tags are marked "shown only on xknot.si".
- **2 · Join XKnot** (submitted once at first join, or on update): a subdomain input with the `.xknot.si` suffix and a "Check" button, the contact email on the right, and a "Submit application" button. When the check fails the button is disabled and the reason is written under the input — so no one fills a whole page before discovering the name can't be issued. The submitted content is the self-description above, so save the profile first. For an already-joined site this block becomes "Update info".
- **3 · What the hub issued** (read-only): id, address, join date, tier, status, from the onboarding file; a final line says this self-description is public at `/api/federation/profile`.

The subdomain is checked once via the hub, not judged locally: `GET /api/admin/xknot/subdomain?label=` forwards to the hub's `GET /api/subdomains/check`, bringing back `available`, `reason`, and suggestions verbatim. Labels under 6 characters are not issued by the hub — short names are reserved; the first rule is written under the input so it never becomes a post-submit surprise.

`POST /api/admin/xknot/apply` hands the self-description and email to the hub's `POST /api/applications`. The hub's 400 (with `fields`) and 409 (duplicate address) come back to this block verbatim, without local rewriting. The first application is opened after human review; for an existing member, the hub returns success immediately.

Troubleshooting info (onboarding file path and permissions, delegated mail, probe address, status signals, drift between the onboarding file and the process) is in a collapsed "Join and probe" section at the bottom of the page, closed by default, which requests `/api/admin/federation` only when expanded.

## 6. Migrating from old config

Before 0.4, name, tagline, logo, and owner lived in six `KNOT_SITE_*` keys in `site.env`. Migrate once:

```bash
node ops/scripts/migrate-profile.mjs --site bot01 --dry-run   # see what it will write first
node ops/scripts/migrate-profile.mjs --site bot01
```

The script reads the old `site.env`, generates `profile.json`, then deletes those six keys from `site.env`. If a v2 `profile.json` already exists it does not write the profile, but still deletes those six keys from `site.env`.

**v1 profiles are upgraded in place**: when `profile.json` is still `formatVersion: 1`, the script picks one copy in simplified Chinese → English → traditional Chinese order, writes it into v2 flat fields, and overwrites the file. Only when nothing converts (not even a name) does it fall back to the old `site.env` values.

**`locale` is backfilled once by the script**: when the profile lacks it, the script infers from whether the name and intro contain CJK characters (`zh-CN` if yes, else `en`) and writes it; `--dry-run` prints what will be written first. The inference is a one-time migration action; once written, the profile is authoritative, and the owner can change it to the actual first target group in `/admin` anytime. When the field already exists, the script touches not a byte.

The `platform.env` generated by the deploy script and the overlay `site.<variant>.env` may still carry these keys; give each with `--env`:

```bash
node ops/scripts/migrate-profile.mjs --site bot01 --env var/bot01/platform.env
```

On the instance host you can run the copy inside the release package directly; the site directory is derived from `KNOT_PROFILE_FILE`, no absolute path needed:

```bash
node current/ops/scripts/migrate-profile.mjs --site bot01 --env sites/bot01/platform.env
```

Restart the Backend after migration.
