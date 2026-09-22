import { getDb } from "@klinpi/db";
import { schema } from "@klinpi/db";
import { eq, asc } from "drizzle-orm";
import type {
  MessageRecord,
  CreateMessageInput,
  MessageRole,
} from "./types.js";

interface MessageRow {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

function rowToRecord(row: MessageRow): MessageRecord {
  return {
    id: row.id,
    sessionId: row.sessionId,
    role: row.role as MessageRole,
    content: row.content,
    metadata: row.metadata,
    createdAt: row.createdAt,
  };
}

export class MessageService {
  private readonly db = getDb();

  async createMessage(input: CreateMessageInput): Promise<MessageRecord> {
    const [row] = await this.db
      .insert(schema.messages)
      .values({
        sessionId: input.sessionId,
        role: input.role,
        content: input.content,
        metadata: input.metadata ?? null,
      })
      .returning();

    return rowToRecord(row as MessageRow);
  }

  async getMessages(
    sessionId: string,
    options?: { limit?: number },
  ): Promise<MessageRecord[]> {
    const limit = options?.limit ?? 20;

    const rows = await this.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.sessionId, sessionId))
      .orderBy(asc(schema.messages.createdAt))
      .limit(limit);

    return rows.map((r) => rowToRecord(r as MessageRow));
  }

  async getMessage(
    sessionId: string,
    messageId: string,
  ): Promise<MessageRecord | null> {
    const [row] = await this.db
      .select()
      .from(schema.messages)
      .where(
        eq(schema.messages.id, messageId) &&
        eq(schema.messages.sessionId, sessionId),
      )
      .limit(1);

    return row ? rowToRecord(row as MessageRow) : null;
  }
}
