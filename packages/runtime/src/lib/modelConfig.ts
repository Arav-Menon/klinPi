import { OLLAMA_BASE_URL, CHAT_MODEL } from "@klinpi/common";

export const modelConfig = {
  baseUrl: OLLAMA_BASE_URL,
  model: CHAT_MODEL,
  timeoutMs: 120_000,
} as const;
