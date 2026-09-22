import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import { getDb, schema } from "@klinpi/db";

const USER_ID = "test-user-001";
const REPO_ID = "test-repo-001";
const SESSION_ID = "test-session-001";

async function seed() {
  const db = getDb();

  await db
    .insert(schema.users)
    .values({
      id: USER_ID,
      email: "test@klinpi.dev",
      name: "Test User",
    })
    .onConflictDoNothing()
    .execute();

  console.log(`User ${USER_ID} seeded.`);

  await db
    .insert(schema.repositories)
    .values({
      id: REPO_ID,
      userId: USER_ID,
      provider: "GITHUB",
      providerRepoId: "123456789",
      owner: "test-owner",
      name: "test-repo",
      fullName: "test-owner/test-repo",
      cloneUrl: "https://github.com/test-owner/test-repo.git",
      defaultBranch: "main",
    })
    .onConflictDoNothing()
    .execute();

  console.log(`Repository ${REPO_ID} seeded.`);

  await db
    .insert(schema.agentSessions)
    .values({
      id: SESSION_ID,
      userId: USER_ID,
      repositoryId: REPO_ID,
      title: "Test Session",
      status: "ACTIVE",
    })
    .onConflictDoNothing()
    .execute();

  console.log(`Session ${SESSION_ID} seeded.`);
  console.log("Seed complete.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
