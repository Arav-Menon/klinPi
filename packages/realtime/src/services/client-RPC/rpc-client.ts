import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "node:path";
import { fileURLToPath } from "node:url";

const _filename = fileURLToPath(import.meta.url);
const _dirname = path.dirname(_filename);

const PROTO_PATH = path.join(_dirname, "../../../../contracts/agent.proto");

const packageDefinition = protoLoader.loadSync(PROTO_PATH);
const grpcObject = grpc.loadPackageDefinition(packageDefinition);

const agentPackage = grpcObject.agent as grpc.GrpcObject;

const AgentServiceClient = agentPackage.AgentService as grpc.ServiceClientConstructor;

export const clientRPC = new AgentServiceClient(
    "localhost:50051",
    grpc.credentials.createInsecure()
);