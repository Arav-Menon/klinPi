import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleRunAgent } from "./agent-handler.js";
import { handleGetFileTree, handleReadFile } from "./workspace-handler.js";

const _filename = fileURLToPath(import.meta.url);
const _dirname = path.dirname(_filename);

const PROTO_PATH = path.join(_dirname, "../../../contracts/agent.proto");
const WORKSPACE_PROTO_PATH = path.join(_dirname, "../../../contracts/workspace.proto");

const packageDefinition = protoLoader.loadSync(PROTO_PATH);
const grpcObject = grpc.loadPackageDefinition(packageDefinition);

const agentService = (grpcObject as any).agent.AgentService;

// `longs: Number` keeps int64 fields (sizes) as plain numbers end-to-end.
const workspaceDefinition = protoLoader.loadSync(WORKSPACE_PROTO_PATH, {
    longs: Number,
});
const workspaceObject = grpc.loadPackageDefinition(workspaceDefinition);
const workspaceService = (workspaceObject as any).workspace.WorkspaceService;

export const server = new grpc.Server();

server.addService(agentService.service, {
    RunAgent: handleRunAgent,
});

server.addService(workspaceService.service, {
    GetFileTree: handleGetFileTree,
    ReadFile: handleReadFile,
});
