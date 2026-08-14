import {WebSocketServer} from "ws"

const wss = new WebSocketServer({port: 8080});

wss.on("connection", socket => {
    console.log("Connection established");
    socket.on("message", (data: Buffer) => {
        const message = data.toString();
        if (message === "ping") {
            socket.send("pong");
        }
    })
})

