import { eq } from "drizzle-orm";
import type { DB } from "./db/client";
import { settings } from "./db/schema";

export async function getSetting<T>(db: DB, key: string, fallback: T): Promise<T> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  return row ? (row.value as T) : fallback;
}

export async function setSetting(db: DB, key: string, value: unknown, updatedBy: string) {
  await db
    .insert(settings)
    .values({ key, value, updatedBy })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedBy, updatedAt: new Date() } });
}
