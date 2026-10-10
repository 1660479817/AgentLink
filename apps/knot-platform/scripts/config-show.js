#!/usr/bin/env node
import pg from "pg";
import { loadBootstrapConfig } from "../src/config.js";
import {
  loadPlatformSettings,
  redactPlatformForLog,
} from "../src/system-config.js";

const bootstrap = loadBootstrapConfig();
const client = new pg.Client({ connectionString: bootstrap.databaseUrl });
await client.connect();
const platform = await loadPlatformSettings(client);
console.log(JSON.stringify(redactPlatformForLog(platform), null, 2));
await client.end();
