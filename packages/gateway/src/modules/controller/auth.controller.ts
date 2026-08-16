import type { Response } from "express";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import * as authService from "../services/auth.service.js";
import { setAuthCookie, clearAuthCookie } from "../../lib/jwt.js";

export async function signup(req: AuthenticatedRequest, res: Response) {
  try {
    const { name, email, password } = req.body;
    const result = await authService.createUser(name, email, password);
    if (!result) {
      res.status(409).json({ error: "User already exists" });
      return;
    }

    setAuthCookie(res, result.token);
    res.status(201).json({ user: result.user });
  } catch (error) {
    console.error("Signup error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function signin(req: AuthenticatedRequest, res: Response) {
  try {
    const { email, password } = req.body;

    const result = await authService.authenticateUser(email, password);
    if (!result) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    setAuthCookie(res, result.token);
    res.status(200).json({ user: result.user });
  } catch (error) {
    console.error("Signin error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function logout(_req: AuthenticatedRequest, res: Response) {
  clearAuthCookie(res);
  res.json({ message: "Logged out successfully" });
}

export async function me(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const user = await authService.getUserById(userId);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json({ user });
  } catch (error) {
    console.error("Me error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}
