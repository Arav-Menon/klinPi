import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

export const DATABASE_URL = process.env.DATABASE_URL as string;
export const JWT_SECRET = process.env.JWT_SECRET as string;
export const NODE_ENV = process.env.NODE_ENV as string | undefined;
export const PORT = process.env.PORT || 3100;

export const NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

export const REDIS_URL = process.env.REDIS_URL as string | undefined;
export const REDIS_HOST = process.env.REDIS_HOST ?? "localhost";
export const REDIS_PORT = Number(process.env.REDIS_PORT ?? 6379);
export const REDIS_USERNAME = process.env.REDIS_USERNAME as string | undefined;
export const REDIS_PASSWORD = process.env.REDIS_PASSWORD as string | undefined;

export const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID as string;
export const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET as string;
export const GITHUB_REDIRECT_URL = process.env.GITHUB_REDIRECT_URL as string;

export const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY as string;
export const E2B_API_KEY = process.env.E2B_API_KEY as string;

export const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
export const CHAT_MODEL = process.env.CHAT_MODEL || "qwen3:4b";
export const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "qwen3-embedding:latest";
export const EMBEDDING_DIMENSION = Number(process.env.EMBEDDING_DIMENSION ?? 1024);
