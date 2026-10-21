import pg from "pg";
import fs from "node:fs";
import path from "node:path";

function sslOption(mode) {
  if (mode === "require") return { rejectUnauthorized: true };
  if (mode === "no-verify") return { rejectUnauthorized: false };
  return undefined;
}

/** Minimal pool wrapper exposing query() and tx(); tx clients expose query() only. */
export function createDb(connectionString, { ssl = process.env.DATABASE_SSL, max = 10 } = {}) {
  const pool = new pg.Pool({ connectionString, max, ssl: sslOption(ssl) });
  pool.on("error", (error) => {
    console.error("Postgres pool error", { errorType: error?.name ?? "Error" });
  });
  return {
    query: (text, params) => pool.query(text, params),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn({ query: (text, params) => client.query(text, params) });
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try { await client.query("ROLLBACK"); } catch { /* connection already unusable */ }
        throw error;
      } finally {
        client.release();
      }
    },
    end: () => pool.end(),
  };
}

export async function runMigrations(db, dir) {
  const files = fs.readdirSync(dir).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
  const applied = [];
  await db.tx(async (tx) => {
    await tx.query("select pg_advisory_xact_lock(727274)");
    await tx.query("create table if not exists schema_migrations (filename text primary key, applied_at timestamptz not null default now())");
    const done = new Set((await tx.query("select filename from schema_migrations")).rows.map((row) => row.filename));
    for (const file of files) {
      if (done.has(file)) continue;
      await tx.query(fs.readFileSync(path.join(dir, file), "utf8"));
      await tx.query("insert into schema_migrations (filename) values ($1)", [file]);
      applied.push(file);
    }
  });
  return applied;
}
