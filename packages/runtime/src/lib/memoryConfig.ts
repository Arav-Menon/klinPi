import { EMBEDDING_MODEL, EMBEDDING_DIMENSION, OLLAMA_BASE_URL } from "@klinpi/common";

export const memoryConfig = {
  embedding: {
    model: EMBEDDING_MODEL,
    dimension: EMBEDDING_DIMENSION,
    ollamaBaseUrl: OLLAMA_BASE_URL,
    timeoutMs: 30_000,
    cacheTtlSeconds: 3600,
  },
  retrieval: {
    topK: 5,
    minSimilarity: 0.3,
  },
  dedup: {
    enabled: true,
    similarityThreshold: 0.95,
  },
} as const;
