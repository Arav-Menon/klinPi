import type { Request } from "express";

export interface ApiKeyAuthenticatedRequest extends Request {
  userId?: string;
}

export interface ApiKeyCreatedResponse {
  id: string;
  name: string;
  key: string;
  keyPrefix: string;
  createdAt: Date;
}

export interface ApiKeyMetadata {
  id: string;
  name: string;
  keyPrefix: string;
  enabled: boolean;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

export interface ApiKeyRevokedResponse {
  id: string;
  name: string;
  keyPrefix: string;
  revokedAt: Date;
}
