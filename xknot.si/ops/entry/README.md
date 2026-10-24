# Entry for issued subdomains (hub side)

This directory holds **what the hub installs on the entry host for a specific issued subdomain**: the concrete domain's nginx conf, and the runbook that takes it from a placeholder to a working `/api`.

It is not entry software and not a template:

| You want to know | See |
|--------|-----|
| How the entry renders, what the template looks like, how to choose `static` vs `proxy` | instance side [`knot-platform/ops/entry/`](../../../knot-platform/ops/entry/) |
| Which conf a subdomain currently has installed, and how to connect it | the `<subdomain>.conf` and `<id>-tunnel.md` in this directory |
| How subdomains are issued, how the handoff sheet is filled | [`../../docs/HANDOFF.md`](../../docs/HANDOFF.md), [`../../docs/JOIN.md`](../../docs/JOIN.md) |

The test: if another instance could reuse it → instance side; if it hardcodes a specific subdomain → this directory.

## Who writes `<subdomain>.conf`

Two writers exist, and they must not fight:

- **Hub auto-connect** (`server/provision.mjs` → `renderVhost`) writes confs whose first line carries `由 auto-connect 生成，请勿手改`. It verifies them every 20 seconds and rewrites when the template changes.
- **The instance's own `push-entry.sh`** writes from `knot-platform/ops/entry/site.conf.template`, with a first line naming `render-config.mjs`. It is the only path that can serve `static` (dist pushed to the entry disk).

The hub reads a conf before touching it and steps aside when the marker is not its own (`MANAGED_MARK` in `server/provision.mjs`, covered by `provision.test.mjs`). That is why an instance can switch itself to static serving without the hub reverting it on the next tick, and why nothing in this directory should be hand-edited into `conf.d/` on a shared host: hand-written confs belong here only when they need maintenance no generator does.

## Existing entries

None yet. `cpswang`'s entry conf is written to `/etc/nginx/conf.d/cpswang.xknot.si.conf` by automatic provisioning and is not kept in the repo; only issuance records needing manual maintenance belong here.

## Why it sits with the hub config

The hub host and the entry host are currently the same machine (`54.169.33.64`). These confs are installed and changed by hub staff during issuance and connection, so they follow the hub repo; but the role ownership is unchanged — they are **config on the entry host**, not config for the hub site `xknot.si`. The easiest mistake on a shared machine is editing the hub site with an entry conf, or the reverse. Concepts in [`../../../docs/concepts.md`](../../../docs/concepts.md).
