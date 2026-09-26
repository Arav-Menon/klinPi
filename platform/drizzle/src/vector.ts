import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

export async function enableVectorExtension(db: NodePgDatabase<Record<string, never>>) {
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
}
