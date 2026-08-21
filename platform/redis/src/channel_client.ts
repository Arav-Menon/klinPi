import type {Redis} from "ioredis";
import {createRedisClient} from "./client.js"

export const channel_client: Redis = createRedisClient();
export const subClient: Redis = createRedisClient();