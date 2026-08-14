import type { Request } from "express";

export interface AuthenticatedRequest extends Request {
  userId?: string;
}

export interface AuthResponse {
  user: {
    id: string;
    email: string;
    name: string | null;
  };
}
