import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "node:path";
import { fileURLToPath } from "node:url";

const _filename = fileURLToPath(import.meta.url);
const _dirname = path.dirname(_filename);

const WORKSPACE_PROTO_PATH = path.join(_dirname, "../../../contracts/workspace.proto");

// `longs: Number` keeps int64 fields (sizes) as plain numbers end-to-end.
const packageDefinition = protoLoader.loadSync(WORKSPACE_PROTO_PATH, {
  longs: Number,
});
const grpcObject = grpc.loadPackageDefinition(packageDefinition);

const workspacePackage = grpcObject.workspace as grpc.GrpcObject;
const WorkspaceServiceClient = workspacePackage.WorkspaceService as grpc.ServiceClientConstructor;

export const workspaceRPC = new WorkspaceServiceClient(
  "localhost:50051",
  grpc.credentials.createInsecure(),
);

export const WORKSPACE_RPC_TIMEOUT_MS = 15_000;

export interface WorkspaceRpcNode {
  name: string;
  path: string;
  kind: string;
  size: number;
  children?: WorkspaceRpcNode[];
}

export interface WorkspaceRpcTree {
  status: string;
  rootName: string;
  entries: WorkspaceRpcNode[];
  truncated: boolean;
}

export interface WorkspaceRpcFile {
  path: string;
  content: string;
  size: number;
  encoding: string;
}

/** gRPC-shaped failure thrown to the service layer for status mapping. */
export class WorkspaceRpcError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = "WorkspaceRpcError";
    this.code = code;
  }
}

function callWithDeadline<T>(
  method: string,
  request: Record<string, unknown>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    (workspaceRPC as any)[method](
      request,
      { deadline: Date.now() + WORKSPACE_RPC_TIMEOUT_MS },
      (error: Error | null, response: T) => {
        if (error) {
          const code = (error as { code?: number }).code ?? grpc.status.UNKNOWN;
          reject(new WorkspaceRpcError(code, error.message));
          return;
        }
        resolve(response);
      },
    );
  });
}

export function getFileTree(sessionId: string, userId: string): Promise<WorkspaceRpcTree> {
  return callWithDeadline<WorkspaceRpcTree>("GetFileTree", { sessionId, userId });
}

export function readFile(
  sessionId: string,
  userId: string,
  filePath: string,
): Promise<WorkspaceRpcFile> {
  return callWithDeadline<WorkspaceRpcFile>("ReadFile", { sessionId, userId, path: filePath });
}
