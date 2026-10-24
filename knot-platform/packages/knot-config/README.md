# @knot/config

The single source of truth for Knot configuration. Each config key is registered here once: type, default, whether required, which machine it belongs to, whether it's a secret.

Three readers share the one registry:

| Reader | Purpose |
| --- | --- |
| `backend/src/config.js` | Get defaults. The code no longer writes a second copy of constants. |
| `backend/src/runtimeConfig.js` | Validate the process environment at startup. Invalid values exit immediately. |
| `ops/scripts/config.mjs` | Validate sites, generate `sites/_template/*`, generate `docs/CONFIG.md`, write instance runtime files. |

This package belongs to the **code layer**. `ops/` is the deployment layer and `sites/<site>/` the config layer; both derive from here rather than each keeping its own copy.

## Adding a config key

1. Add an entry to `SITE_KEYS` (site topology, written into `site.env`) or `PLATFORM_KEYS` (instance-host runtime values, written into `platform.env`) in `src/schema.mjs`;
2. A runtime key must declare `runtime`, its name in the process environment (e.g. `KNOT_PORT` → `PORT`);
3. Back in `knot-platform/`, run:

```bash
node ops/scripts/config.mjs template --write
node ops/scripts/config.mjs platform-template --write
node ops/scripts/config.mjs docs --write
npm test
```

Any drift among template, docs, and code defaults fails `packages/knot-config/src/schema.test.js`.
