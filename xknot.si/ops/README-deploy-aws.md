# xknot.si hub deployment

For the compute assistant / ops: hosting the **federation portal**'s static site and application API on a public host.

This is the federation portal's own deployment. Partner sites deployed with `knot-platform` are not here and are not managed by these scripts; if the two are on the same machine, it only means they share a host, not a dependency.

This machine is both the **hub host** and the **entry host** (the entry for `wang.xknot.si` and other instances). Roles and ownership in [`docs/concepts.md`](../../docs/concepts.md): the hub's config belongs to this project's `ops/`, the entry's config belongs to the instance side `knot-platform/ops/entry/`, and the two do not reference each other.

## Host

The repo does not hardcode the host. The values below are only the current instance; when they change, go by the actual machine, or override the env vars directly.

```bash
HUB=ec2-user@54.169.33.64
KEY=~/.ssh/suanli-sg-probe.pem
```

| Item | Value |
|----|----|
| Region | `ap-southeast-1` |
| Instance | `i-0c876685a64c75538` |
| Public | `54.169.33.64` (changes with EIP / rebuild) |
| SSH | `ssh -i $KEY $HUB` (`id_rsa` is rejected on this machine) |
| DNS | the A records of `xknot.si` and `www` point here |
| Other sites on the same machine | this machine also hosts instance-side sites: `/var/www/wang` (`wang.xknot.si`), and the unrelated `/var/www/aiugc`. Each config under `conf.d/` is independent; always `nginx -t` before changing a conf |

The portal and these instance sites share one machine, but directories, processes, and configs do not overlap: the portal is `/var/www/xknot` + `/opt/xknot` + `xknot-api`, and the instances are their own `ops/` deployment artifacts. What they share is only the nginx process, the certificate directory, and this machine's capacity.

## Paths

| Path | Use |
|------|------|
| `/var/www/xknot` | portal static (`web/dist`) |
| `/opt/xknot/server` | API source `server/index.mjs` |
| `/opt/xknot/admin` | console static |
| `/opt/xknot/docs` | this project's docs (systemd's `Documentation=`) |
| `/opt/xknot/instances.json` | the instance manifest the API reads (mail relay checks whether an instance is listed and active) |
| `/opt/xknot/ops/validate-instances.mjs` | manifest validation (a dependency of `manifest.mjs`) |
| `/opt/xknot/ops/{check-health,watch-health,fetch-guard}.mjs` | scheduled health patrol: probe, mail, temporary hiding |
| `/opt/xknot/ops/{peers,geoip}.mjs` | site location: tunnel peer → egress IP → country code |
| `/opt/xknot/var/geoip/` | DB-IP Lite database + IP resolution cache + `locations.json` (generated, ~4.5 MB, not in the repo) |
| `/opt/xknot/web/src/lib/` | pure functions and static tables (`i18n`, `regions`), a dependency of fallback validation; deployed as a whole directory |
| `/opt/xknot/var` | SQLite / session-secret (`0600`, do not commit) |
| `/etc/nginx/conf.d/xknot.si.conf` | portal + `/api` `/admin` reverse proxy |
| `/etc/systemd/system/xknot-api.service` | the API resident |
| `/etc/systemd/system/xknot-health.{service,timer}` | patrol every 15 minutes |
| `/etc/systemd/system/xknot-provision.service` | automatic provisioning: configures the entry host item by item, changes to `active` after the probe passes |
| `/opt/xknot/var/provision.env` | input for automatic provisioning: `XKNOT_ENTRY_HOST` (`0600`, generated from `XKNOT_ENTRY_HOST` on first deploy) |

## Environment variables (systemd)

See unit `ops/xknot-api.service`:

| Variable | Production value |
|------|--------|
| `XKNOT_API_HOST` | `127.0.0.1` |
| `XKNOT_API_PORT` | `5181` |
| `XKNOT_DATA_DIR` | `/opt/xknot/var` |
| `XKNOT_TRUST_PROXY` | `1` |
| `XKNOT_SECURE_COOKIE` | `1` when HTTPS (the current unit already sets `1`); only turn off temporarily in the HTTP phase |
| `XKNOT_PUBLIC_ORIGIN` | `https://xknot.si` |
| `EnvironmentFile` | `-/opt/xknot/var/mail.env`, optional; when missing it just does not send mail |

The API listens only on the loopback; nginx reverse-proxies `/api/` and `/admin/`.

Automatic provisioning has its own input, see unit `ops/xknot-provision.service`:

| Variable | Production value |
|------|--------|
| `XKNOT_ENTRY_HOST` | the entry host's public address (same machine as the hub: `54.169.33.64`); written to `/opt/xknot/var/provision.env`, not into the unit |
| `XKNOT_ADMIN_EMAIL` | the certificate registration email, reusing `XKNOT_ADMIN_EMAIL` from `mail.env` |
| `XKNOT_PROVISION_INTERVAL_MS` | optional, default `20000` |
| `XKNOT_AFTER_ACTIVATE` | optional; an extra command to run after changing to `active` (the portal snapshot is already recomputed by the worker itself; this is only for supplementary actions) |

The worker advances one step per round, recording only an error code on failure (`dns_missing`, `tls_failed`…) and retrying in place; these codes show as-is in the XKnot section of the instance admin UI. It needs `sudo`: creating accounts, writing sshd and nginx config, running certbot. **DNS is not in its hands** — the entry domain needs a wildcard `*.xknot.si → XKNOT_ENTRY_HOST`; without it the `dns` step never passes.

## Mail (optional)

Sending credentials do not go into the unit (the unit is `0644`); they live in `/opt/xknot/var/mail.env`, mode `0600`:

```bash
ssh -i "$KEY" "$HUB"
sudo install -m 600 -o ec2-user -g ec2-user /dev/null /opt/xknot/var/mail.env
sudo -u ec2-user vi /opt/xknot/var/mail.env
```

Contents (Aliyun DirectMail, 465 implicit TLS). `SMTP_HOST` follows the console region: East China is `smtpdm.aliyun.com`, Singapore is `smtpdm-ap-southeast-1.aliyuncs.com`.

```bash
SMTP_HOST=smtpdm.aliyun.com
SMTP_PORT=465
SMTP_SECURE=1
SMTP_USER=no-reply@xknot.si
SMTP_PASS='the SMTP password of that sending address, not the Aliyun login password'
SMTP_FROM=no-reply@xknot.si
MAIL_FROM=no-reply@xknot.si
XKNOT_ADMIN_EMAIL=manwjh@gmail.com
```

`xknot.si`'s MX already points to `mx01.dm.aliyun.com`; this domain only sends. Do not configure a corporate mailbox to receive on it.

`SMTP_USER` must equal `SMTP_FROM`, which is Aliyun DirectMail's auth rule. After changing a unit or env:

```bash
sudo systemctl daemon-reload
sudo systemctl restart xknot-api
sudo -u ec2-user bash -c 'set -a; . /opt/xknot/var/mail.env; set +a; cd /opt/xknot && npm run mail:test -- manwjh@gmail.com'
```

The test mail only proves SMTP auth and delivery; whether it lands in the inbox depends on `spf=pass`, `dkim=pass`, `dmarc=pass` in the recipient's raw headers. After verifying the sending domain in the Aliyun console, do not delete the DNS records.

After creating a new sending address or changing an SMTP password, Aliyun's propagation has a delay; within about 10 minutes it still returns `535 Authentication failure`. Wait a bit before retrying, rather than assuming a wrong password. The region must match the console: East China is `smtpdm.aliyun.com`; hitting the Singapore endpoint with an East China address also returns 535.

When sharing with partners, create one sending address per site under one sending domain, each with its own SMTP password; partners fill only the six `SMTP_*` / `MAIL_FROM` above, and must not receive the hub's admin mailbox or session secret.

## Build and deploy

```bash
cd xknot.si

# static site
./ops/build-hub.sh                 # or --offline
XKNOT_HUB_SSH=$HUB XKNOT_SSH_KEY=$KEY ./ops/deploy-hub.sh

# API, console, and config
XKNOT_HUB_SSH=$HUB XKNOT_SSH_KEY=$KEY ./ops/deploy-api.sh
```

`deploy-hub.sh` already `--exclude .well-known` to avoid wiping the ACME challenge directory; it carries `--delete`, so it first refuses empty values, the root, the site parent, and the source directory itself, and dry-runs once before the real sync to print what will be deleted. `deploy-api.sh` syncs `server/`, `admin/`, `docs/`, the whole `ops/`, `web/src/lib/`, and `instances.json`, installs the nginx config and eight systemd units (`xknot-api`, `xknot-provision`, `xknot-health.{service,timer}`, `xknot-traffic.{service,timer}`, `xknot-republish.{service,timer}`). Accounts, ports — all these gateway scripts live in `ops/`, so that whole layer goes over as a directory; before syncing it runs `ops/check-server-imports.mjs`, and if an import in `server/` falls outside `server/`, `ops/`, `web/src/lib/`, the script exits outright — that style passes locally and in unit tests, but remotely it is guaranteed `ERR_MODULE_NOT_FOUND`. The nginx config is backed up first (`<conf>.bak-<UTC time>`, keeping the latest 10), then written; if `nginx -t` fails it restores the old file and exits; on success it daemon-reloads, restarts the API, enables the three timers, reloads nginx, and finally verifies `/api/health` on the loopback. The two do not overwrite each other.

Automatic provisioning adds nodes directly to `instances.json` and `federation.json` on the hub; the two copies in the repo do not follow. So before syncing, `deploy-api.sh` compares the id sets: if the hub has an id the repo lacks, it refuses to overwrite and asks you to pull first:

```bash
XKNOT_HUB_SSH=$HUB XKNOT_SSH_KEY=$KEY ./ops/deploy-api.sh --pull-manifest
```

Pulling overwrites the repo's two files (each keeps a `.pull-backup`), then prompts to commit after `validate` passes. **The order is "pull, commit, then deploy"**; doing it the other way deletes the just-connected node from the manifest — the portal loses a card, and the worker's next round finds the entry gone entirely (it restores it via `provision_runs` and records `instance.manifest_restored`, but you should not count on that fallback).

The portal data section (`/var/www/xknot/data/hub.json`) is recomputed by `xknot-republish.timer` every 10 minutes, no frontend redeploy needed; the worker also recomputes it immediately on connect.

To see what will happen without touching the remote:

```bash
XKNOT_HUB_SSH=$HUB ./ops/deploy-hub.sh --dry-run
XKNOT_HUB_SSH=$HUB ./ops/deploy-api.sh --dry-run
```

## nginx current state

- `xknot.si` / `www.xknot.si`: 443 serves the portal, `/` 302s to `/en/`; 80 only keeps ACME and 301s to HTTPS.
- The 443 server enables gzip (text types, including JS/CSS/JSON/SVG/XML); images and fonts are not compressed since they are already compressed. The portal is a pure static site; if this layer does not compress, nothing else will.
- `/api/`, `/admin/` reverse-proxy to `127.0.0.1:5181`; `/assets/` long-cache, `/data/hub.json` uses `no-cache`.
- The portal carries HSTS, `nosniff`, `Referrer-Policy`, `X-Frame-Options: DENY`, and CSP; `/admin/`'s strict CSP is sent by the API's `serveAdminFile`, nginx only adds HSTS. Do not write `add_header` on `/assets/` and `/data/hub.json`, otherwise nginx drops the server-level security headers.
- There are no other subdomains. `root.xknot.si` is deleted: DNS records, nginx config, and certificate are all cleaned up; do not add it back.
- Certificates are managed by Certbot; do not touch the `ssl_certificate` lines.

## Certificate

```bash
# 1) confirm A/AAAA point here and HTTP ACME is reachable
curl -sI -H 'Host: xknot.si' http://54.169.33.64/.well-known/acme-challenge/ping

# 2) sign the certificate (webroot)
sudo certbot certonly --webroot -w /var/www/xknot -d xknot.si -d www.xknot.si

# 3) reload and confirm the Secure Cookie is on
sudo nginx -t && sudo systemctl reload nginx
sudo systemctl show xknot-api -p Environment   # should contain XKNOT_SECURE_COOKIE=1
```

`xknot.si`'s certificate covers both names `xknot.si` and `www.xknot.si`.

## Acceptance

Verify by domain (certificate and SNI both take the real path):

```bash
curl -sI https://xknot.si/                        # 302 → /en/
curl -sI https://xknot.si/en/                     # 200
curl -sI -H 'Accept-Encoding: gzip' https://xknot.si/assets/<main js> | grep -i content-encoding  # gzip
curl -sI https://xknot.si/data/hub.json           # 200, no-cache
curl -s  https://xknot.si/api/health              # {"ok":true,...}
curl -sI https://xknot.si/admin/                  # 200
curl -sI https://xknot.si/api/admin/applications   # 401

# other sites on the same machine must be unaffected
curl -sI https://wang.xknot.si/                   # instance, 200
```

When DNS has not switched and you only want to verify this machine, use `--resolve`, not a direct IP:

```bash
curl -sI --resolve xknot.si:443:54.169.33.64 https://xknot.si/
```

## instances.json note

The manifest currently has three instances: the self-operated flagship `wang` (`https://wang.xknot.si`), the community member `cpswang` (`https://cpswang.xknot.si`), and `zhoujj` (`https://zhoujj.xknot.si`), all `subdomain` mode and `status: active`. The manifest has no probe-address field; the address is always `url` + `/api/health`. `root.xknot.si` is offline; do not list it again. The portal can go live first; probe results are build-time samples and do not affect the static site or the application API.

## Adding and delisting instances

Adding one: automatic provisioning writes the manifest and roster itself (`status` first `pending`, then `active` after acceptance), no manual listing needed; **what must be done by hand is syncing it back to the repo** — `./ops/deploy-api.sh --pull-manifest`, then `npm run validate` and commit. Adding one manually: change `federation.json` first (identity, tunnel account and port), then `instances.json` (issued zone), then `npm run validate`. Delisting one: delete the entry from both files at once, then delete the conf and static root on the entry host; `var/health.json` and `var/status.json` drop it naturally on the next patrol, and the copy in `var/profiles/` must be deleted by hand. The subdomain follows the `*.xknot.si` wildcard, so there is no separate DNS record to clear.

History: `zjj` (issued 2026-10-19, never connected) was an early experiment, delisted 2026-10-22 with its listing and entry files removed.

## Instance side

How an instance deploys, and how its entry and tunnel are configured, is outside this document. The current instance implementation is `knot-platform`: entry and tunnel in `knot-platform/ops/entry/README.md`, host and keys given by each `sites/<site>/site.env`. Swapping implementations does not change this document — the hub only recognizes `/api/health` and the access material.

## Forbidden

- Do not run certbot for xknot.si before the NS switch
- Do not change Dynadot / do not touch the Route53 `zenheart` zone
- Do not terminate the instance; do not stop other sites' services on the same machine
