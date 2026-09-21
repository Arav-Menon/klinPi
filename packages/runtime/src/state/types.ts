import type { MemoryType, MemoryImportance } from "@klinpi/db";

export type { MemoryType, MemoryImportance };

export interface MemoryRecord {
  id: string;
  userId: string;
  repositoryId: string | null;
  sessionId: string | null;
  type: MemoryType;
  content: string;
  normalizedContent: string;
  importance: MemoryImportance;
  embedding: number[] | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateMemoryInput {
  userId: string;
  repositoryId?: string | null;
  sessionId?: string | null;
  type: MemoryType;
  content: string;
  importance?: MemoryImportance;
  metadata?: Record<string, unknown> | null;
}

export interface UpdateMemoryInput {
  content?: string;
  type?: MemoryType;
  importance?: MemoryImportance;
  metadata?: Record<string, unknown> | null;
}

export interface RetrieveMemoriesInput {
  userId: string;
  repositoryId?: string | null;
  query: string;
  topK?: number;
  types?: MemoryType[];
  minImportance?: MemoryImportance;
}

export interface MemorySearchResult {
  memory: MemoryRecord;
  similarity: number;
}

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  invalidate(text: string): Promise<void>;
  dimension: number;
}
