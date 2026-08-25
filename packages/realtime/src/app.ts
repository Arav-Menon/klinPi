import {WebSocketServer, WebSocket} from "ws"
import type {IncomingMessage} from "node:http";
import {verify} from "./verify/verify.js";
import {AgentSessionManager} from "./modules/AgentSessionManager.js";

export class realtimeServer {
    private wss: WebSocketServer;
    private agentSessionManager: AgentSessionManager;

    constructor(port: number) {
        this.wss = new WebSocketServer({port});
        this.agentSessionManager = new AgentSessionManager()
    }

    start() {
        try {
            this.wss.on("connection", (socket: WebSocket, req: IncomingMessage) => {
                this.handleConnection(socket, req);
            })
        } catch (err: any) {
            throw new Error(err);
        }
    }

    handleConnection(socket: WebSocket, req: IncomingMessage) {
        try {
            const url = new URL(req.url!, "ws://localhost");
            const protocol = req.headers["sec-websocket-protocol"];
            let token = typeof protocol === "string" ? protocol.replace("Bearer ", "") : null;

            if (!token) {
                const url = new URL(req.url!, "ws://localhost");
                token = url.searchParams.get("token");
            }
            if (!token) {
                socket.send(JSON.stringify({type: "error", message: "Missing authentication token"}));
                socket.close(1008, "Unauthorized");
                return;
            }
            const payload = verify(token);
            if (!payload) {
                socket.send(JSON.stringify({type: "error", message: "Invalid or expired token"}));
                socket.close(1008, "Unauthorized");
                return;
            }

            const userId = payload.sub;
            socket.send(JSON.stringify({type: "connected", userId: userId}));

            socket.on("message", (message: string) => {
                try {
                    const data = JSON.parse(message.toString());
                    const userPrompt = data.userPrompt as string
                    const sessionId = data.sessionId as string

                    if (data.type == "CALL_TO_AGENT") {
                        const agentCallData = {
                            userId: userId,
                            sessionId: sessionId,
                            prompt: userPrompt,
                            socket: socket
                        }
                        this.agentSessionManager.SessionCheck(agentCallData);
                    }

                } catch (err) {
                    console.error(err)
                    socket.send(JSON.stringify({type: "error", message: "Invalid message format"}));
                }
            })
        } catch {
            socket.send(JSON.stringify({type: "error", message: "Connection failed"}));
            socket.close(1011, "Internal error");
        }
    }
}
