import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { realtimeServer } from "./app.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const PORT = Number(8083);
const server = new realtimeServer(PORT);
server.start();
