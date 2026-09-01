import {server} from "./server-RPC/rpc-server.js"
import * as grpc from "@grpc/grpc-js";

server.bindAsync("0.0.0.0:50051", grpc.ServerCredentials.createInsecure(), (error, port) => {
    if (error) {
        console.error(error);
        return
    }
    console.log(`gRPC server is running on port ${port}`)
})