import { createHash } from "node:crypto";
import axios from "axios";
import { cache } from "@klinpi/redis";
import type { EmbeddingProvider } from "./types.js";
import { memoryConfig } from "../lib/memoryConfig.js";

const CACHE_PREFIX = "memory:embed:";

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly dimension = memoryConfig.embedding.dimension;

  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly cacheTtl: number;

  constructor() {
    this.baseUrl = memoryConfig.embedding.ollamaBaseUrl;
    this.model = memoryConfig.embedding.model;
    this.timeoutMs = memoryConfig.embedding.timeoutMs;
    this.cacheTtl = memoryConfig.embedding.cacheTtlSeconds;
  }

  async embed(text: string): Promise<number[]> {
    const trimmed = text.trim();
    if (!trimmed) {
      return this.fetchFromOllama(text);
    }

    const cacheKey = this.buildCacheKey(trimmed);

    try {
      const cached = await cache.getCache(cacheKey);
      if (cached) {
        return cached as number[];
      }
    } catch (err: unknown) {
      console.error("Embedding cache read failed, falling back to Ollama:", err);
    }

    const embedding = await this.fetchFromOllama(trimmed);

    cache.setCache(cacheKey, embedding, this.cacheTtl).catch((err) => {
      console.error("Embedding cache write failed:", err);
    });

    return embedding;
  }

  async invalidate(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;

    const cacheKey = this.buildCacheKey(trimmed);

    try {
      await cache.deleteCache(cacheKey);
    } catch (err) {
      console.error("Embedding cache invalidate failed:", err);
    }
  }

  private buildCacheKey(text: string): string {
    const hash = createHash("sha256")
      .update(`${text}:${this.model}`)
      .digest("hex");
    return `${CACHE_PREFIX}${hash}`;
  }

  private async fetchFromOllama(text: string): Promise<number[]> {
    const response = await axios.post<{ embeddings?: number[][] }>(
      `${this.baseUrl}/api/embed`,
      {
        model: this.model,
        input: text,
      },
      {
        timeout: this.timeoutMs,
        headers: { "Content-Type": "application/json" },
      },
    );

    const data = response.data;

    if (!data.embeddings || data.embeddings.length === 0) {
      throw new Error("Embedding response contained no vectors");
    }

    const embedding = data.embeddings[0]!;

    if (embedding.length !== this.dimension) {
      throw new Error(
        `Embedding dimension mismatch: expected ${this.dimension}, got ${embedding.length}`,
      );
    }

    return embedding;
  }
}
