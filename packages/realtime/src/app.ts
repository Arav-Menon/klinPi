import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import { verify } from "./verify/verify.js";
import { AgentSessionManager } from "./modules/AgentSessionManager.js";
import { sessionRouter, safeSend } from "./modules/SessionRouter.js";

export class realtimeServer {
  private wss: WebSocketServer;
  private agentSessionManager: AgentSessionManager;

  constructor(port: number) {
    this.wss = new WebSocketServer({ port });
    this.agentSessionManager = new AgentSessionManager();
  }

  start() {
    try {
      this.wss.on("connection", (socket: WebSocket, req: IncomingMessage) => {
        this.handleConnection(socket, req);
      });
      console.log(`realtime server is started on port 8083`);
    } catch (err: any) {
      throw new Error(err);
    }
  }

  handleConnection(socket: WebSocket, req: IncomingMessage) {
    try {
      const url = new URL(req.url!, "ws://localhost");
      const protocol = req.headers["sec-websocket-protocol"];
      let token =
        typeof protocol === "string" ? protocol.replace("Bearer ", "") : null;

      if (!token) {
        const url = new URL(req.url!, "ws://localhost");
        token = url.searchParams.get("token");
      }
      if (!token) {
        socket.send(
          JSON.stringify({
            type: "error",
            message: "Missing authentication token",
          }),
        );
        socket.close(1008, "Unauthorized");
        return;
      }
      const payload = verify(token);
      if (!payload) {
        socket.send(
          JSON.stringify({
            type: "error",
            message: "Invalid or expired token",
          }),
        );
        socket.close(1008, "Unauthorized");
        return;
      }

      const userId = payload.sub;
      socket.send(JSON.stringify({ type: "connected", userId: userId }));

      socket.on("close", () => {
        sessionRouter.unsubscribeAll(socket);
      });

      socket.on("message", (message: string) => {
        try {
          const data = JSON.parse(message.toString());
          const userPrompt = data.userPrompt as string;
          const sessionId = data.sessionId as string;

          if (data.type == "CALL_TO_AGENT") {
            const repositoryId = data.repositoryId as string | undefined;
            const agentCallData = {
              userId: userId,
              sessionId: sessionId,
              prompt: userPrompt,
              repositoryId: repositoryId,
              socket: socket,
            };
            this.agentSessionManager
              .SessionCheck(agentCallData)
              .catch((err) => {
                console.error("SessionCheck failed:", err);
                safeSend(
                  socket,
                  JSON.stringify({
                    type: "error",
                    message: "Failed to start agent run",
                  }),
                );
              });
          }

          if (data.type == "SUBSCRIBE_SESSION") {
            if (!sessionId) {
              safeSend(
                socket,
                JSON.stringify({
                  type: "error",
                  message: "sessionId is required",
                }),
              );
              return;
            }
            sessionRouter.subscribe(socket, sessionId, userId).catch((err) => {
              console.error("Subscribe failed:", err);
              const reason =
                err instanceof Error ? err.message : "Subscribe failed";
              safeSend(
                socket,
                JSON.stringify({ type: "error", message: reason }),
              );
            });
          }
        } catch (err) {
          console.error(err);
          socket.send(
            JSON.stringify({
              type: "error",
              message: "Invalid message format",
            }),
          );
        }
      });
    } catch {
      socket.send(
        JSON.stringify({ type: "error", message: "Connection failed" }),
      );
      socket.close(1011, "Internal error");
    }
  }
}
