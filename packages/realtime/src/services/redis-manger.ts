import { pubClient, subClient } from "@klinpi/redis";

type MessageCallback = (channel: string, message: string) => void;

class RedisManger {
    private pub = pubClient;
    private sub = subClient;
    private listeners: Map<string, Set<MessageCallback>> = new Map();
    private dispatcherAttached = false;

    async publish(channel: string, message: unknown): Promise<number> {
        const payload = typeof message === "string" ? message : JSON.stringify(message);
        return await this.pub.publish(channel, payload)
    }

    private attachDispatcher() {
        if (this.dispatcherAttached) return;
        this.dispatcherAttached = true;

        this.sub.on("message", (ch: string, msg: string) => {
            const callbacks = this.listeners.get(ch);
            if (!callbacks) return;
            for (const cb of callbacks) {
                cb(ch, msg);
            }
        });
    }

    async subscribe(channel: string, callback: MessageCallback): Promise<void> {
        this.attachDispatcher();

        let callbacks = this.listeners.get(channel);
        if (!callbacks) {
            callbacks = new Set();
            this.listeners.set(channel, callbacks);
            await this.sub.subscribe(channel);
        }
        callbacks.add(callback);
    }

    async unsubscribe(channel: string, callback?: MessageCallback): Promise<void> {
        const callbacks = this.listeners.get(channel);
        if (!callbacks) return;

        if (callback) {
            callbacks.delete(callback);
        }

        if (!callback || callbacks.size === 0) {
            this.listeners.delete(channel);
            await this.sub.unsubscribe(channel);
        }
    }

}

export const redisManger = new RedisManger();