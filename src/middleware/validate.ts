import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

export const validate = (schema: ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const details = error.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        }));
        console.warn(
          `[Validate] 400 on ${req.method} ${req.path}:`,
          JSON.stringify(details),
          '| body keys:', Object.keys(req.body || {}),
        );
        res.status(400).json({ error: 'Validation failed', details });
        return;
      }
      next(error);
    }
  };
};
