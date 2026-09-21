import {Redis} from "ioredis";
import type {RedisOptions} from "ioredis";

function getRedisConfig(): RedisOptions | string {
    if (process.env.REDIS_URL) {
        return process.env.REDIS_URL;
    }

    return {
        host: process.env.REDIS_HOST ?? "localhost",
        port: Number(process.env.REDIS_PORT ?? 6379),
        username: process.env.REDIS_USERNAME,
        password: process.env.REDIS_PASSWORD,
        lazyConnect: true,
        retryStrategy(times) {
            return Math.min(times * 50, 2000);
        },
        maxRetriesPerRequest: null,
    };
}

const config: string | RedisOptions = getRedisConfig();

export function createRedisClient(): Redis {
    //@ts-ignore
    const client = new Redis(config);
    client.on("error", () => {});
    return client;
}
