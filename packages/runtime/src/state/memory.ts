import { getDb } from "@klinpi/db";
import { schema } from "@klinpi/db";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import type {
  CreateMemoryInput,
  UpdateMemoryInput,
  RetrieveMemoriesInput,
  MemoryRecord,
  MemorySearchResult,
  EmbeddingProvider,
  MemoryType,
  MemoryImportance,
} from "./types.js";
import { memoryConfig } from "../lib/memoryConfig.js";

function normalizeContent(content: string): string {
  return content.toLowerCase().trim().replace(/\s+/g, " ");
}

interface MemoryRow {
  id: string;
  userId: string;
  repositoryId: string | null;
  sessionId: string | null;
  type: string;
  content: string;
  normalizedContent: string;
  importance: string;
  embedding: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

function parseEmbedding(value: unknown): number[] | null {
  if (value == null) return null;
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return JSON.parse(value) as number[];
  return null;
}

function rowToRecord(row: MemoryRow): MemoryRecord {
  return {
    id: row.id,
    userId: row.userId,
    repositoryId: row.repositoryId,
    sessionId: row.sessionId,
    type: row.type as MemoryType,
    content: row.content,
    normalizedContent: row.normalizedContent,
    importance: row.importance as MemoryImportance,
    embedding: parseEmbedding(row.embedding),
    metadata: row.metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class MemoryService {
  private readonly db = getDb();
  private readonly embeddingProvider: EmbeddingProvider;

  constructor(embeddingProvider: EmbeddingProvider) {
    this.embeddingProvider = embeddingProvider;
  }

  async createMemory(input: CreateMemoryInput): Promise<MemoryRecord> {
    const normalized = normalizeContent(input.content);

    if (memoryConfig.dedup.enabled) {
      const existing = await this.findDuplicate(
        input.userId,
        input.repositoryId ?? null,
        normalized,
      );
      if (existing) {
        return existing;
      }
    }

    const embedding = await this.embeddingProvider.embed(input.content);

    const [row] = await this.db
      .insert(schema.memories)
      .values({
        userId: input.userId,
        repositoryId: input.repositoryId ?? null,
        sessionId: input.sessionId ?? null,
        type: input.type,
        content: input.content,
        normalizedContent: normalized,
        importance: input.importance ?? "MEDIUM",
        embedding: embedding,
        metadata: input.metadata ?? null,
      })
      .returning();

    return rowToRecord(row as MemoryRow);
  }

  async retrieveRelevant(
    input: RetrieveMemoriesInput,
  ): Promise<MemorySearchResult[]> {
    const topK = input.topK ?? memoryConfig.retrieval.topK;
    const queryEmbedding = await this.embeddingProvider.embed(input.query);

    const embeddingStr = JSON.stringify(queryEmbedding);

    const conditions = [
      sql`m."userId" = ${input.userId}`,
      sql`m."embedding" IS NOT NULL`,
    ];

    if (input.repositoryId) {
      conditions.push(
        sql`(m."repositoryId" = ${input.repositoryId} OR m."repositoryId" IS NULL)`,
      );
    } else {
      conditions.push(sql`m."repositoryId" IS NULL`);
    }

    if (input.types && input.types.length > 0) {
      conditions.push(
        sql`m."type" IN (${sql.join(
          input.types.map((t) => sql`${t}`),
          sql`, `,
        )})`,
      );
    }

    if (input.minImportance) {
      const importanceOrder: Record<MemoryImportance, number> = {
        LOW: 1,
        MEDIUM: 2,
        HIGH: 3,
      };
      const minLevel = importanceOrder[input.minImportance];
      conditions.push(
        sql`CASE m."importance" WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 1 ELSE 0 END >= ${minLevel}`,
      );
    }

    const query = sql`
      SELECT
        m."id",
        m."userId",
        m."repositoryId",
        m."sessionId",
        m."type",
        m."content",
        m."normalizedContent",
        m."importance",
        m."embedding",
        m."metadata",
        m."createdAt",
        m."updatedAt",
        (1 - (m."embedding" <=> ${embeddingStr}::vector)) AS "similarity"
      FROM "Memory" m
      WHERE ${sql.join(conditions, sql` AND `)}
      ORDER BY m."embedding" <=> ${embeddingStr}::vector
      LIMIT ${topK}
    `;

    const rows = await this.db.execute(query);

    const results: MemorySearchResult[] = [];
    for (const row of rows.rows) {
      const r = row as Record<string, unknown>;
      const similarity = Number(r.similarity);

      if (similarity >= memoryConfig.retrieval.minSimilarity) {
        results.push({
          memory: {
            id: r.id as string,
            userId: r.userId as string,
            repositoryId: (r.repositoryId as string) ?? null,
            sessionId: (r.sessionId as string) ?? null,
            type: r.type as MemoryType,
            content: r.content as string,
            normalizedContent: r.normalizedContent as string,
            importance: r.importance as MemoryImportance,
            embedding: parseEmbedding(r.embedding),
            metadata: (r.metadata as Record<string, unknown>) ?? null,
            createdAt: r.createdAt as Date,
            updatedAt: r.updatedAt as Date,
          },
          similarity,
        });
      }
    }

    return results;
  }

  async getMemory(
    userId: string,
    memoryId: string,
  ): Promise<MemoryRecord | null> {
    const [row] = await this.db
      .select()
      .from(schema.memories)
      .where(
        and(
          eq(schema.memories.id, memoryId),
          eq(schema.memories.userId, userId),
        ),
      )
      .limit(1);

    return row ? rowToRecord(row as MemoryRow) : null;
  }

  async listMemories(
    userId: string,
    options?: {
      repositoryId?: string | null;
      type?: MemoryType;
      limit?: number;
      cursor?: string;
    },
  ): Promise<{ memories: MemoryRecord[]; nextCursor: string | undefined }> {
    const limit = options?.limit ?? 50;
    const conditions = [eq(schema.memories.userId, userId)];

    if (options?.repositoryId != null) {
      conditions.push(eq(schema.memories.repositoryId, options.repositoryId));
    }
    if (options?.type) {
      conditions.push(eq(schema.memories.type, options.type));
    }
    if (options?.cursor) {
      conditions.push(
        sql`${schema.memories.createdAt} > ${new Date(options.cursor)}`,
      );
    }

    const rows = await this.db
      .select()
      .from(schema.memories)
      .where(and(...conditions))
      .orderBy(desc(schema.memories.createdAt))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const memories = rows.slice(0, limit).map((r) => rowToRecord(r as MemoryRow));

    return {
      memories,
      nextCursor: hasMore ? memories[memories.length - 1]?.id : undefined,
    };
  }

  async updateMemory(
    userId: string,
    memoryId: string,
    input: UpdateMemoryInput,
  ): Promise<MemoryRecord | null> {
    const existing = await this.getMemory(userId, memoryId);
    if (!existing) return null;

    const updateData: Record<string, unknown> = {};

    if (input.content !== undefined) {
      await this.embeddingProvider.invalidate(existing.content);
      updateData.content = input.content;
      updateData.normalizedContent = normalizeContent(input.content);
      updateData.embedding = await this.embeddingProvider.embed(input.content);
    }
    if (input.type !== undefined) {
      updateData.type = input.type;
    }
    if (input.importance !== undefined) {
      updateData.importance = input.importance;
    }
    if (input.metadata !== undefined) {
      updateData.metadata = input.metadata;
    }
    updateData.updatedAt = new Date();

    const [row] = await this.db
      .update(schema.memories)
      .set(updateData)
      .where(
        and(
          eq(schema.memories.id, memoryId),
          eq(schema.memories.userId, userId),
        ),
      )
      .returning();

    return row ? rowToRecord(row as MemoryRow) : null;
  }

  async deleteMemory(userId: string, memoryId: string): Promise<boolean> {
    const existing = await this.getMemory(userId, memoryId);
    if (!existing) return false;

    const [deleted] = await this.db
      .delete(schema.memories)
      .where(
        and(
          eq(schema.memories.id, memoryId),
          eq(schema.memories.userId, userId),
        ),
      )
      .returning({ id: schema.memories.id });

    if (deleted) {
      await this.embeddingProvider.invalidate(existing.content);
    }

    return !!deleted;
  }

  private async findDuplicate(
    userId: string,
    repositoryId: string | null,
    normalizedContent: string,
  ): Promise<MemoryRecord | null> {
    const conditions = [
      eq(schema.memories.userId, userId),
      eq(schema.memories.normalizedContent, normalizedContent),
    ];

    if (repositoryId) {
      conditions.push(eq(schema.memories.repositoryId, repositoryId));
    } else {
      conditions.push(sql`${schema.memories.repositoryId} IS NULL`);
    }

    const [existing] = await this.db
      .select()
      .from(schema.memories)
      .where(and(...conditions))
      .limit(1);

    return existing ? rowToRecord(existing as MemoryRow) : null;
  }
}
