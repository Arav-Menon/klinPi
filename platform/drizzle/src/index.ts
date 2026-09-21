import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { DATABASE_URL } from "@klinpi/common";
import * as schema from "./schema.js";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (!_db) {
    const pool = new Pool({
      connectionString: DATABASE_URL,
    });
    _db = drizzle(pool, { schema });
  }
  return _db;
}

export { schema };

export type SessionStatus = typeof schema.sessionStatusEnum.enumValues[number];
export type MemoryType = typeof schema.memoryTypeEnum.enumValues[number];
export type MemoryImportance = typeof schema.memoryImportanceEnum.enumValues[number];
