import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadBootstrapConfig } from "../src/config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "..", "migrations");

async function main() {
  const { databaseUrl } = loadBootstrapConfig();
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const present = await client.query(
    `SELECT to_regclass('public.users') AS users,
            to_regclass('public.persons') AS persons,
            to_regclass('public.expressions') AS expressions`
  );
  const marker = present.rows[0] || {};
  if (!marker.users || marker.persons || marker.expressions) {
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
  }
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const { rows } = await client.query(
      "SELECT 1 FROM schema_migrations WHERE name = $1",
      [file]
    );
    if (rows.length) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log("applied", file);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  }
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
