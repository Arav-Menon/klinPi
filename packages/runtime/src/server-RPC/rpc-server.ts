import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "node:path";
import {fileURLToPath} from "node:url";

const _filename = fileURLToPath(import.meta.url);
const _dirname = path.dirname(_filename);

const PROTO_PATH = path.join(_dirname, "../../../contracts/agent.proto");

const packageDefinition = protoLoader.loadSync(PROTO_PATH);
const grpcObject = grpc.loadPackageDefinition(packageDefinition);

export const agentService = grpcObject.AgentService as any;

export const server = new grpc.Server();
