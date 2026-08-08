import crypto from "crypto";
import { prisma } from "../../lib/prisma.js";

const KEY_PREFIX = "kp_live_";
const SECRET_BYTES = 32;
const KEY_PREFIX_LENGTH = 12;
const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;

function hashKey(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

export async function createApiKey(userId: string, name: string) {
  const db = prisma();

  const secret = crypto.randomBytes(SECRET_BYTES).toString("hex");
  const rawKey = `${KEY_PREFIX}${secret}`;
  const keyPrefix = rawKey.substring(0, KEY_PREFIX_LENGTH);
  const keyHash = hashKey(rawKey);

  const apiKey = await db.apiKey.create({
    data: {
      keyHash,
      keyPrefix,
      name,
      userId,
    },
  });

  return {
    id: apiKey.id,
    name: apiKey.name,
    key: rawKey,
    keyPrefix: apiKey.keyPrefix,
    createdAt: apiKey.createdAt,
  };
}

export async function listApiKeys(userId: string) {
  const db = prisma();

  const keys = await db.apiKey.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      enabled: true,
      createdAt: true,
      lastUsedAt: true,
      revokedAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return keys;
}

export async function revokeApiKey(userId: string, keyId: string) {
  const db = prisma();

  const key = await db.apiKey.findFirst({
    where: { id: keyId, userId },
  });

  if (!key) {
    return null;
  }

  const updated = await db.apiKey.update({
    where: { id: keyId },
    data: {
      enabled: false,
      revokedAt: new Date(),
    },
  });

  return {
    id: updated.id,
    name: updated.name,
    keyPrefix: updated.keyPrefix,
    revokedAt: updated.revokedAt,
  };
}

export async function authenticateApiKey(rawKey: string) {
  const db = prisma();

  if (!rawKey.startsWith(KEY_PREFIX)) {
    return null;
  }

  const keyHash = hashKey(rawKey);

  const key = await db.apiKey.findUnique({
    where: { keyHash },
    select: {
      id: true,
      enabled: true,
      revokedAt: true,
      lastUsedAt: true,
      userId: true,
    },
  });

  if (!key || !key.enabled || key.revokedAt) {
    return null;
  }

  const now = new Date();
  if (
    !key.lastUsedAt ||
    now.getTime() - key.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS
  ) {
    await db.apiKey.update({
      where: { id: key.id },
      data: { lastUsedAt: now },
    });
  }

  return { userId: key.userId };
}
