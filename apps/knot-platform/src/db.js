import pg from "pg";

let pool;

export function getPool(databaseUrl) {
  if (!pool) {
    pool = new pg.Pool({ connectionString: databaseUrl });
  }
  return pool;
}
