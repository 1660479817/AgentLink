# API index

The public layer only indexes; the full text stays in each project, to avoid maintaining one interface spec twice. The single exception is the Agent interface guide: it describes a federation-wide protocol that belongs to no single instance, so its full text lives in this directory.

| Interface | Project | Document | Notes |
|------|------|------|------|
| Instance Web API | `knot-platform` | [`knot-platform/docs/KNOT_WEB_API.md`](../knot-platform/docs/KNOT_WEB_API.md) | The read/write interface shared by the WebUI and Personal Agents: records, retrieval, downloads, accounts, authorization codes |
| Agent interface guide | Public layer | [`KNOT_HELP.md`](./KNOT_HELP.md) | The federation-wide Agent protocol spec, English text; built and published by `xknot.si` as <https://xknot.si/knot-help> (HTML) and `/knot-help.md` (raw). Instances provide no documentation endpoint. The same-directory [`KNOT_HELP_CN.md`](./KNOT_HELP_CN.md) is the Chinese cross-check draft, for translation review only, not published |
| Health check | `knot-platform` | `/api/health` | Used by the federation hub to probe instance status; fields in [`xknot.si/docs/FEDERATION.md`](../xknot.si/docs/FEDERATION.md) §5 |
| Federation contract | `xknot.si` | [`xknot.si/docs/FEDERATION.md`](../xknot.si/docs/FEDERATION.md) | The hub-instance L1 profile, L2 status and activity data, L3 showcase conventions |
| Delegated mail | `xknot.si` | [`xknot.si/docs/FEDERATION.md`](../xknot.si/docs/FEDERATION.md) §7 | `POST /api/federation/mail`: the instance uses Bearer credentials to delegate the hub's SMTP to send one plain-text notification; `GET` queries quota |
| Hub interface | `xknot.si` | [`xknot.si/server/app.mjs`](../xknot.si/server/app.mjs) | Open to the public: join application (passes on submission), claim pickup, health and location query, subdomain dedup, member code rotation; admin sessions and roster writes require credentials |
| Onboarding file | `xknot.si` | [`xknot.si/docs/FEDERATION.md`](../xknot.si/docs/FEDERATION.md) §7.4 | The env file the hub issues to an instance: instance id, hub address, issue date, delegated-mail credentials; the instance decides its own filename |
| Deployment config | `knot-platform` | [`knot-platform/docs/CONFIG.md`](../knot-platform/docs/CONFIG.md) | Site and platform environment variables; key types and defaults are defined by `packages/knot-config/src/schema.mjs` |

Calling conventions, auth, and error codes follow each project's own text. This page only answers "which document is that interface in".
