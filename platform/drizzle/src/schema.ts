import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  json,
  jsonb,
  index,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";

export const sessionStatusEnum = pgEnum("SessionStatus", [
  "ACTIVE",
  "PAUSED",
  "COMPLETED",
  "FAILED",
  "ARCHIVED",
]);

export const messageRoleEnum = pgEnum("MessageRole", [
  "USER",
  "ASSISTANT",
  "SYSTEM",
  "TOOL",
]);

export const agentRunStatusEnum = pgEnum("AgentRunStatus", [
  "QUEUED",
  "RUNNING",
  "WAITING_FOR_USER",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);

export const toolCallStatusEnum = pgEnum("ToolCallStatus", [
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);

export const sandboxStatusEnum = pgEnum("SandboxStatus", [
  "CREATING",
  "RUNNING",
  "STOPPED",
  "DESTROYED",
  "FAILED",
]);

export const repositoryProviderEnum = pgEnum("RepositoryProvider", [
  "GITHUB",
]);

export const approvalStatusEnum = pgEnum("ApprovalStatus", [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
]);

export const memoryTypeEnum = pgEnum("MemoryType", [
  "USER_PREFERENCE",
  "REPOSITORY_KNOWLEDGE",
  "SESSION_NOTE",
  "FACT",
  "INSTRUCTION",
]);

export const memoryImportanceEnum = pgEnum("MemoryImportance", [
  "LOW",
  "MEDIUM",
  "HIGH",
]);

export const users = pgTable(
  "User",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    email: text("email").notNull().unique(),
    passwordHash: text("passwordHash"),
    name: text("name"),
    avatarUrl: text("avatarUrl"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
);

export const oauthAccounts = pgTable(
  "OAuthAccount",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    accessToken: text("accessToken"),
    refreshToken: text("refreshToken"),
    expiresAt: timestamp("expiresAt"),
  },
  (table) => [
    uniqueIndex("OAuthAccount_provider_providerAccountId_idx").on(
      table.provider,
      table.providerAccountId,
    ),
    index("OAuthAccount_userId_idx").on(table.userId),
  ],
);

export const repositories = pgTable(
  "Repository",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: repositoryProviderEnum("provider").notNull(),
    providerRepoId: text("providerRepoId").notNull(),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    fullName: text("fullName").notNull(),
    cloneUrl: text("cloneUrl").notNull(),
    defaultBranch: text("defaultBranch").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("Repository_provider_providerRepoId_idx").on(
      table.provider,
      table.providerRepoId,
    ),
    index("Repository_userId_idx").on(table.userId),
  ],
);

export const agentSessions = pgTable(
  "AgentSession",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    repositoryId: text("repositoryId").references(() => repositories.id, {
      onDelete: "set null",
    }),
    title: text("title"),
    status: sessionStatusEnum("status").default("ACTIVE").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (table) => [
    index("AgentSession_userId_updatedAt_idx").on(table.userId, table.updatedAt),
    index("AgentSession_repositoryId_idx").on(table.repositoryId),
  ],
);

export const messages = pgTable(
  "Message",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    sessionId: text("sessionId")
      .notNull()
      .references(() => agentSessions.id, { onDelete: "cascade" }),
    role: messageRoleEnum("role").notNull(),
    content: text("content").notNull(),
    metadata: json("metadata"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    index("Message_sessionId_createdAt_idx").on(table.sessionId, table.createdAt),
  ],
);

export const agentRuns = pgTable(
  "AgentRun",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    sessionId: text("sessionId")
      .notNull()
      .references(() => agentSessions.id, { onDelete: "cascade" }),
    status: agentRunStatusEnum("status").default("QUEUED").notNull(),
    startedAt: timestamp("startedAt"),
    completedAt: timestamp("completedAt"),
    error: text("error"),
    metadata: json("metadata"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    index("AgentRun_sessionId_createdAt_idx").on(table.sessionId, table.createdAt),
  ],
);

export const toolCalls = pgTable(
  "ToolCall",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    agnetId: text("agnetId")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    messageId: text("messageId").references(() => messages.id, {
      onDelete: "set null",
    }),
    toolName: text("toolName").notNull(),
    status: toolCallStatusEnum("status").default("PENDING").notNull(),
    input: json("input").notNull(),
    output: json("output"),
    error: text("error"),
    startedAt: timestamp("startedAt"),
    completedAt: timestamp("completedAt"),
  },
  (table) => [
    index("ToolCall_agnetId_idx").on(table.agnetId),
    index("ToolCall_messageId_idx").on(table.messageId),
  ],
);

export const sandboxes = pgTable(
  "Sandbox",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    sessionId: text("sessionId")
      .notNull()
      .references(() => agentSessions.id, { onDelete: "cascade" }),
    providerSandboxId: text("providerSandboxId").notNull().unique(),
    provider: text("provider").default("e2b").notNull(),
    status: sandboxStatusEnum("status").default("CREATING").notNull(),
    workspacePath: text("workspacePath"),
    branchName: text("branchName"),
    commitSha: text("commitSha"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    lastActiveAt: timestamp("lastActiveAt"),
    destroyedAt: timestamp("destroyedAt"),
  },
  (table) => [
    index("Sandbox_sessionId_status_idx").on(table.sessionId, table.status),
  ],
);

export const approvals = pgTable(
  "Approval",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    agentId: text("agentId")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    toolName: text("toolName").notNull(),
    input: json("input").notNull(),
    status: approvalStatusEnum("status").default("PENDING").notNull(),
    decision: json("decision"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    decidedAt: timestamp("decidedAt"),
    expiresAt: timestamp("expiresAt"),
  },
  (table) => [
    index("Approval_agentId_status_idx").on(table.agentId, table.status),
  ],
);

export const memories = pgTable(
  "Memory",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    repositoryId: text("repositoryId").references(() => repositories.id, {
      onDelete: "set null",
    }),
    sessionId: text("sessionId").references(() => agentSessions.id, {
      onDelete: "set null",
    }),
    type: memoryTypeEnum("type").notNull(),
    content: text("content").notNull(),
    normalizedContent: text("normalizedContent").notNull(),
    importance: memoryImportanceEnum("importance").default("MEDIUM").notNull(),
    embedding: vector("embedding", { dimensions: 1024 }),
    metadata: jsonb("metadata"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (table) => [
    index("Memory_userId_type_idx").on(table.userId, table.type),
    index("Memory_userId_repositoryId_idx").on(table.userId, table.repositoryId),
    index("Memory_normalizedContent_userId_idx").on(
      table.normalizedContent,
      table.userId,
    ),
  ],
);
