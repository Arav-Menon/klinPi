import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleRunAgent } from "./agent-handler.js";

const _filename = fileURLToPath(import.meta.url);
const _dirname = path.dirname(_filename);

const PROTO_PATH = path.join(_dirname, "../../../contracts/agent.proto");

const packageDefinition = protoLoader.loadSync(PROTO_PATH);
const grpcObject = grpc.loadPackageDefinition(packageDefinition);

const agentService = (grpcObject as any).agent.AgentService;

export const server = new grpc.Server();

server.addService(agentService.service, {
    RunAgent: handleRunAgent,
});
