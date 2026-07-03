import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code: string = 'APP_ERROR',
    public data: unknown = null,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

interface HttpError extends Error {
  statusCode?: number;
  status?: number;
  type?: string;
}

export function errorHandler(
  err: HttpError,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      data: null,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Datos de entrada inválidos',
        details: err.flatten().fieldErrors,
      },
      meta: null,
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      data: err.data ?? null,
      error: { code: err.code, message: err.message },
      meta: null,
    });
    return;
  }

  // body-parser / multer errors (tienen statusCode explícito)
  const httpStatus = err.statusCode ?? err.status;
  if (httpStatus && httpStatus >= 400 && httpStatus < 500) {
    res.status(httpStatus).json({
      data: null,
      error: { code: 'BAD_REQUEST', message: err.message },
      meta: null,
    });
    return;
  }

  console.error('Unhandled error:', err);
  res.status(500).json({
    data: null,
    error: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor' },
    meta: null,
  });
}
