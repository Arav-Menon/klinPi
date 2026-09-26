import type { Redis } from "ioredis";
import { createRedisClient } from "./client.js"

export const pubClient: Redis = createRedisClient();
export const subClient: Redis = createRedisClient();