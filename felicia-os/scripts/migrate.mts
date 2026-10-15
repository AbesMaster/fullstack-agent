/** Applies database migrations (PostgreSQL via DATABASE_URL, or embedded PGlite in development). */
import { createDb, migrate } from "../src/lib/db/client.ts";

const db = await createDb();
await migrate(db);
console.log("Migrations applied.");
process.exit(0);
