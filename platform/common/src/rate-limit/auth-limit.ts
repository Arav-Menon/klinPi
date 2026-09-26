import {rateLimit} from "express-rate-limit"
import {createRedisClient} from "@klinpi/redis";
import {RedisStore, type RedisReply} from "rate-limit-redis";

const client = createRedisClient();

export const authLimit = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    statusCode: 429,
    handler: (req, res) => res.status(429).json({error: "Too many auth requests, please try again after 10 minutes"}),
    store: new RedisStore({
        sendCommand: (command: string, ...args: string[]) =>
            client.call(command, ...args) as Promise<RedisReply>,
    }),
})