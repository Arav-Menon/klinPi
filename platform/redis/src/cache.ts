import { createRedisClient } from "./client.js";

export class RedisCache {
  private readonly cache = createRedisClient();

  public async getCache(key: string) {
    const value = await this.cache.get(key);
    if (!value) return null;
    return value ? JSON.parse(value) : null;
  }

  public async setCache(key: string, value: unknown, ttl?: number) {
    const serialized = JSON.stringify(value);
    if (ttl) {
      await this.cache.setex(key, ttl, serialized);
    } else {
      await this.cache.set(key, serialized);
    }
  }

  public async deleteCache(key: string) {
    await this.cache.del(key);
  }

  public async deleteByPattern(pattern: string) {
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
  }
}

export const cache = new RedisCache();
