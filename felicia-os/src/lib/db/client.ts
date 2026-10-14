import path from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";
import { env } from "../config/env";

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");

/**
 * Production/staging: PostgreSQL (with pgvector) via DATABASE_URL.
 * Development/tests/demo: embedded PGlite (real Postgres compiled to WASM, with pgvector).
 */
export async function createDb(opts: { url?: string; pgliteDir?: string; inMemory?: boolean } = {}): Promise<DB> {
  const url = opts.url ?? (opts.inMemory ? undefined : env().DATABASE_URL);
  if (url) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const pool = new Pool({ connectionString: url, max: 10 });
    return drizzle(pool, { schema }) as unknown as DB;
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { vector } = await import("@electric-sql/pglite/vector");
  const { drizzle } = await import("drizzle-orm/pglite");
  const dataDir = opts.inMemory ? undefined : (opts.pgliteDir ?? env().PGLITE_DIR);
  if (dataDir) (await import("node:fs")).mkdirSync(path.dirname(path.resolve(dataDir)), { recursive: true });
  const client = await PGlite.create({ dataDir, extensions: { vector } });
  return drizzle(client, { schema }) as unknown as DB;
}

export async function migrate(db: DB, opts: { url?: string; inMemory?: boolean } = {}) {
  const url = opts.url ?? (opts.inMemory ? undefined : env().DATABASE_URL);
  if (url) {
    const { migrate: m } = await import("drizzle-orm/node-postgres/migrator");
    await m(db as never, { migrationsFolder: MIGRATIONS_DIR });
  } else {
    const { migrate: m } = await import("drizzle-orm/pglite/migrator");
    await m(db as never, { migrationsFolder: MIGRATIONS_DIR });
  }
}

/** Isolated, migrated in-memory database for tests and the demo. */
export async function createTestDb(): Promise<DB> {
  const db = await createDb({ inMemory: true });
  await migrate(db, { inMemory: true });
  return db;
}

let shared: Promise<DB> | undefined;

/** Process-wide DB for the Next.js server. Applies migrations on first use. */
export function getDb(): Promise<DB> {
  if (!shared) {
    shared = (async () => {
      const db = await createDb();
      await migrate(db);
      return db;
    })();
  }
  return shared;
}
