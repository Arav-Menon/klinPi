import type { Request, Response, NextFunction } from "express";
import type { ZodSchema } from "zod";

export function validateQuery(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      const firstError = result.error.errors[0];
      if (firstError) {
        res.status(400).json({ error: firstError.message });
      } else {
        res.status(400).json({ error: "Validation failed" });
      }
      return;
    }
    // Express 5 exposes `req.query` as a getter-only property, so a plain
    // assignment throws. Shadow it with an own data property instead.
    Object.defineProperty(req, "query", {
      value: result.data,
      writable: true,
      configurable: true,
      enumerable: true,
    });
    next();
  };
}
