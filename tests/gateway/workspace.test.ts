import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import * as grpc from "@grpc/grpc-js";

const rpcMock = vi.hoisted(() => ({
  getFileTree: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock("../../packages/gateway/src/lib/workspace-rpc.js", () => ({
  getFileTree: rpcMock.getFileTree,
  readFile: rpcMock.readFile,
  WorkspaceRpcError: class WorkspaceRpcError extends Error {
    code: number;
    constructor(code: number, message: string) {
      super(message);
      this.name = "WorkspaceRpcError";
      this.code = code;
    }
  },
  workspaceRPC: {},
  WORKSPACE_RPC_TIMEOUT_MS: 15_000,
}));

import app from "../../packages/gateway/src/app";
import { WorkspaceRpcError } from "../../packages/gateway/src/lib/workspace-rpc.js";

const EMAILS = ["workspace-owner@test.com", "workspace-other@test.com"];

async function cleanup() {
  const { db } = await import("../../packages/gateway/src/lib/db");
  const { users } = await import("@klinpi/db/schema");
  const { inArray } = await import("drizzle-orm");
  await db().delete(users).where(inArray(users.email, EMAILS));
}

function newClient() {
  return request.agent(app);
}

describe("Workspace API", () => {
  const owner = newClient();
  const other = newClient();
  let ownerSessionId: string;

  beforeAll(async () => {
    await cleanup();
    for (const [i, client] of [owner, other].entries()) {
      const res = await client.post("/api/v1/auth/signup").send({
        name: "Workspace Tester",
        email: EMAILS[i]!,
        password: "password123",
      });
      expect(res.status).toBe(201);
    }
    const created = await owner.post("/api/v1/sessions").send({ prompt: "workspace probe" });
    expect(created.status).toBe(201);
    ownerSessionId = created.body.session.id;
  });

  afterAll(async () => {
    await cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    rpcMock.getFileTree.mockReset();
    rpcMock.readFile.mockReset();
  });

  describe("GET /api/v1/sessions/:sessionId/workspace/tree", () => {
    it("requires authentication", async () => {
      const res = await request(app).get(`/api/v1/sessions/${ownerSessionId}/workspace/tree`);
      expect(res.status).toBe(401);
      expect(rpcMock.getFileTree).not.toHaveBeenCalled();
    });

    it("returns the sandbox file tree for the session owner", async () => {
      rpcMock.getFileTree.mockResolvedValue({
        status: "ready",
        rootName: "klinpi",
        truncated: false,
        entries: [
          {
            name: "src",
            path: "src",
            kind: "dir",
            size: 0,
            children: [
              { name: "index.ts", path: "src/index.ts", kind: "file", size: 12, children: undefined },
            ],
          },
        ],
      });

      const res = await owner.get(`/api/v1/sessions/${ownerSessionId}/workspace/tree`);

      expect(res.status).toBe(200);
      expect(res.body.workspace).toEqual({
        status: "ready",
        rootName: "klinpi",
        truncated: false,
        entries: [
          {
            name: "src",
            path: "src",
            kind: "dir",
            size: 0,
            children: [
              { name: "index.ts", path: "src/index.ts", kind: "file", size: 12, children: undefined },
            ],
          },
        ],
      });
      expect(rpcMock.getFileTree).toHaveBeenCalledWith(ownerSessionId, expect.any(String));
    });

    it("returns 404 when the session belongs to another user", async () => {
      const res = await other.get(`/api/v1/sessions/${ownerSessionId}/workspace/tree`);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Session not found" });
      expect(rpcMock.getFileTree).not.toHaveBeenCalled();
    });

    it("returns 404 for a session that does not exist", async () => {
      const res = await owner.get(
        "/api/v1/sessions/00000000-0000-0000-0000-000000000000/workspace/tree",
      );
      expect(res.status).toBe(404);
      expect(rpcMock.getFileTree).not.toHaveBeenCalled();
    });

    it("surfaces a not_ready tree as-is", async () => {
      rpcMock.getFileTree.mockResolvedValue({
        status: "not_ready",
        rootName: "workspace",
        entries: [],
        truncated: false,
      });
      const res = await owner.get(`/api/v1/sessions/${ownerSessionId}/workspace/tree`);
      expect(res.status).toBe(200);
      expect(res.body.workspace.status).toBe("not_ready");
    });

    it("maps an unavailable runtime to 502", async () => {
      rpcMock.getFileTree.mockRejectedValue(
        new WorkspaceRpcError(grpc.status.UNAVAILABLE, "runtime unreachable"),
      );
      const res = await owner.get(`/api/v1/sessions/${ownerSessionId}/workspace/tree`);
      expect(res.status).toBe(502);
      expect(res.body).toEqual({ error: "Workspace service unavailable", code: "UNAVAILABLE" });
    });
  });

  describe("GET /api/v1/sessions/:sessionId/workspace/file", () => {
    it("requires a path query parameter", async () => {
      const res = await owner.get(`/api/v1/sessions/${ownerSessionId}/workspace/file`);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/required/i);
      expect(rpcMock.readFile).not.toHaveBeenCalled();
    });

    it("returns the file contents for the session owner", async () => {
      rpcMock.readFile.mockResolvedValue({
        path: "src/index.ts",
        content: "export const answer = 42;\n",
        size: 25,
        encoding: "utf-8",
      });

      const res = await owner
        .get(`/api/v1/sessions/${ownerSessionId}/workspace/file`)
        .query({ path: "src/index.ts" });

      expect(res.status).toBe(200);
      expect(res.body.file).toEqual({
        path: "src/index.ts",
        content: "export const answer = 42;\n",
        size: 25,
        encoding: "utf-8",
      });
      expect(rpcMock.readFile).toHaveBeenCalledWith(ownerSessionId, expect.any(String), "src/index.ts");
    });

    it("returns 404 when the session belongs to another user", async () => {
      const res = await other
        .get(`/api/v1/sessions/${ownerSessionId}/workspace/file`)
        .query({ path: "src/index.ts" });
      expect(res.status).toBe(404);
      expect(rpcMock.readFile).not.toHaveBeenCalled();
    });

    it("maps a missing file to 404", async () => {
      rpcMock.readFile.mockRejectedValue(
        new WorkspaceRpcError(grpc.status.NOT_FOUND, "File not found"),
      );
      const res = await owner
        .get(`/api/v1/sessions/${ownerSessionId}/workspace/file`)
        .query({ path: "src/nope.ts" });
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "File not found", code: "NOT_FOUND" });
    });

    it("maps path traversal to 400 INVALID_PATH", async () => {
      rpcMock.readFile.mockRejectedValue(
        new WorkspaceRpcError(grpc.status.INVALID_ARGUMENT, "Invalid file path"),
      );
      const res = await owner
        .get(`/api/v1/sessions/${ownerSessionId}/workspace/file`)
        .query({ path: "../etc/passwd" });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("INVALID_PATH");
    });

    it("maps an oversized file to 413", async () => {
      rpcMock.readFile.mockRejectedValue(
        new WorkspaceRpcError(grpc.status.RESOURCE_EXHAUSTED, "File is too large to display"),
      );
      const res = await owner
        .get(`/api/v1/sessions/${ownerSessionId}/workspace/file`)
        .query({ path: "big.bin" });
      expect(res.status).toBe(413);
      expect(res.body.code).toBe("TOO_LARGE");
    });

    it("maps a not-ready workspace to 400 NOT_READY", async () => {
      rpcMock.readFile.mockRejectedValue(
        new WorkspaceRpcError(grpc.status.FAILED_PRECONDITION, "Workspace is not ready yet"),
      );
      const res = await owner
        .get(`/api/v1/sessions/${ownerSessionId}/workspace/file`)
        .query({ path: "src/index.ts" });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("NOT_READY");
    });

    it("maps a directory path to 400 NOT_A_FILE", async () => {
      rpcMock.readFile.mockRejectedValue(
        new WorkspaceRpcError(grpc.status.FAILED_PRECONDITION, "Path is not a regular file"),
      );
      const res = await owner
        .get(`/api/v1/sessions/${ownerSessionId}/workspace/file`)
        .query({ path: "src" });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("NOT_A_FILE");
    });

    it("maps binary content to 400 BINARY", async () => {
      rpcMock.readFile.mockRejectedValue(
        new WorkspaceRpcError(grpc.status.FAILED_PRECONDITION, "Binary files cannot be displayed"),
      );
      const res = await owner
        .get(`/api/v1/sessions/${ownerSessionId}/workspace/file`)
        .query({ path: "logo.png" });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("BINARY");
    });

    it("maps an unreachable runtime to 502", async () => {
      rpcMock.readFile.mockRejectedValue(
        new WorkspaceRpcError(grpc.status.DEADLINE_EXCEEDED, "deadline"),
      );
      const res = await owner
        .get(`/api/v1/sessions/${ownerSessionId}/workspace/file`)
        .query({ path: "src/index.ts" });
      expect(res.status).toBe(502);
      expect(res.body.code).toBe("UNAVAILABLE");
    });
  });
});
