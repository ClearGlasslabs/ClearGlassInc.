import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDb, runMigrations } from "../src/subscriptions/db.js";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL must be configured to run migrations");
  process.exit(1);
}
const db = createDb(process.env.DATABASE_URL, { max: 1 });
try {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
  const applied = await runMigrations(db, dir);
  console.log(applied.length ? `Applied migrations: ${applied.join(", ")}` : "No pending migrations");
} catch (error) {
  console.error("Migration failed", { errorType: error?.name ?? "Error", message: error?.message });
  process.exitCode = 1;
} finally {
  await db.end();
}
