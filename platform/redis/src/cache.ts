import { createRedisClient } from "./client.js";

export class RedisCache {
  private readonly cache = createRedisClient();

  public async getCache(key: string): Promise<unknown> {
    try {
      const value = await this.cache.get(key);
      if (!value) return null;
      return JSON.parse(value);
    } catch (err) {
      console.error("Redis getCache failed:", err);
      return null;
    }
  }

  public async setCache(key: string, value: unknown, ttl?: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      if (ttl) {
        await this.cache.setex(key, ttl, serialized);
      } else {
        await this.cache.set(key, serialized);
      }
    } catch (err) {
      console.error("Redis setCache failed:", err);
    }
  }

  public async deleteCache(key: string): Promise<void> {
    try {
      await this.cache.del(key);
    } catch (err) {
      console.error("Redis deleteCache failed:", err);
    }
  }

  public async deleteByPattern(pattern: string): Promise<void> {
    try {
      let cursor = "0";
      do {
        const [nextCursor, keys] = await this.cache.scan(
          cursor,
          "MATCH",
          pattern,
          "COUNT",
          100,
        );
        cursor = nextCursor;
        if (keys.length > 0) {
          await this.cache.del(...keys);
        }
      } while (cursor !== "0");
    } catch (err) {
      console.error("Redis deleteByPattern failed:", err);
    }
  }
}

export const cache = new RedisCache();
