export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;

    // Maintains proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }

  static unauthorized(message = 'Unauthorized', code = 'UNAUTHORIZED'): AppError {
    return new AppError(401, code, message);
  }

  static forbidden(message = 'Forbidden', code = 'FORBIDDEN'): AppError {
    return new AppError(403, code, message);
  }

  static notFound(message = 'Not found', code = 'NOT_FOUND'): AppError {
    return new AppError(404, code, message);
  }

  static conflict(message = 'Conflict', code = 'CONFLICT'): AppError {
    return new AppError(409, code, message);
  }

  static badRequest(message = 'Bad request', code = 'BAD_REQUEST'): AppError {
    return new AppError(400, code, message);
  }

  static internal(message = 'Internal server error', code = 'INTERNAL_ERROR'): AppError {
    return new AppError(500, code, message);
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}