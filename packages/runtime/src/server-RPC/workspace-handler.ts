import * as grpc from "@grpc/grpc-js";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@klinpi/db";
import { getWorkspaceFile, getWorkspaceTree } from "../workspace/service.js";
import { WorkspaceFileError } from "../workspace/types.js";
import type { WorkspaceNode } from "../workspace/types.js";

/**
 * Unary gRPC handlers for the WorkspaceService contract
 * (packages/contracts/workspace.proto), served on the existing runtime
 * server (port 50051) next to AgentService.
 *
 * The gateway performs the browser-facing authorization; handlers
 * re-verify the session ownership here as defense in depth and resolve
 * the session's live sandbox via the runtime-owned lifecycle service.
 */

async function assertSessionOwnership(sessionId: string, userId: string): Promise<void> {
    if (typeof sessionId !== "string" || !sessionId || typeof userId !== "string" || !userId) {
        throw Object.assign(new Error("Session not found"), {
            grpcCode: grpc.status.NOT_FOUND,
        });
    }
    const db = getDb();
    const [found] = await db
        .select({ id: schema.agentSessions.id })
        .from(schema.agentSessions)
        .where(and(eq(schema.agentSessions.id, sessionId), eq(schema.agentSessions.userId, userId)))
        .limit(1);
    if (!found) {
        throw Object.assign(new Error("Session not found"), {
            grpcCode: grpc.status.NOT_FOUND,
        });
    }
}

function toProtoNodes(nodes: WorkspaceNode[]): Array<Record<string, unknown>> {
    return nodes.map((node) => ({
        name: node.name,
        path: node.path,
        kind: node.kind,
        size: node.size,
        children: node.children ? toProtoNodes(node.children) : [],
    }));
}

function fileErrorToGrpc(error: WorkspaceFileError): { code: grpc.status; message: string } {
    switch (error.code) {
        case "INVALID_PATH":
            return { code: grpc.status.INVALID_ARGUMENT, message: error.message };
        case "NOT_FOUND":
            return { code: grpc.status.NOT_FOUND, message: error.message };
        case "TOO_LARGE":
            return { code: grpc.status.RESOURCE_EXHAUSTED, message: error.message };
        case "NOT_READY":
            return { code: grpc.status.FAILED_PRECONDITION, message: error.message };
        case "NOT_A_FILE":
        case "BINARY":
        case "UNREADABLE":
        default:
            return { code: grpc.status.FAILED_PRECONDITION, message: error.message };
    }
}

function toGrpcError(error: unknown): { code: grpc.status; message: string } {
    if (error instanceof WorkspaceFileError) return fileErrorToGrpc(error);
    const withCode = error as { grpcCode?: grpc.status; message?: string };
    if (typeof withCode?.grpcCode === "number") {
        return { code: withCode.grpcCode, message: withCode.message ?? "Request failed" };
    }
    console.error("[Workspace] gRPC handler error:", error);
    return { code: grpc.status.INTERNAL, message: "Internal error" };
}

export async function handleGetFileTree(call: any, callback: any): Promise<void> {
    const { sessionId, userId } = call.request as { sessionId?: string; userId?: string };
    try {
        await assertSessionOwnership(sessionId ?? "", userId ?? "");
        const tree = await getWorkspaceTree(sessionId!);
        callback(null, {
            status: tree.status,
            rootName: tree.rootName,
            entries: toProtoNodes(tree.entries),
            truncated: tree.truncated,
        });
    } catch (error) {
        const { code, message } = toGrpcError(error);
        callback({ code, message }, null);
    }
}

export async function handleReadFile(call: any, callback: any): Promise<void> {
    const { sessionId, userId, path } = call.request as {
        sessionId?: string;
        userId?: string;
        path?: string;
    };
    try {
        await assertSessionOwnership(sessionId ?? "", userId ?? "");
        const file = await getWorkspaceFile(sessionId!, path ?? "");
        callback(null, {
            path: file.path,
            content: file.content,
            size: file.size,
            encoding: file.encoding,
        });
    } catch (error) {
        const { code, message } = toGrpcError(error);
        callback({ code, message }, null);
    }
}
