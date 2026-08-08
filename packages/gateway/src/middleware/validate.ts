import type { Request, Response, NextFunction } from "express";
import type { ZodSchema } from "zod";

export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const firstError = result.error.errors[0];
      if (firstError) {
        res.status(400).json({ error: firstError.message });
      } else {
        res.status(400).json({ error: "Validation failed" });
      }
      return;
    }
    req.body = result.data;
    next();
  };
}
