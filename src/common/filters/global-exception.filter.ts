import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';

/**
 * Single exception filter that normalizes all errors to a consistent
 * { statusCode, message, error, path, timestamp } shape.
 *
 * Maps Prisma errors to meaningful HTTP statuses.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { statusCode, message, error } = this.toResponseShape(exception);

    if (statusCode >= 500) {
      this.logger.error(
        `${request.method} ${request.url} → ${statusCode} ${message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(statusCode).json({
      statusCode,
      message,
      error,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }

  private toResponseShape(exception: unknown): {
    statusCode: number;
    message: string | string[];
    error: string;
  } {
    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      if (typeof res === 'string') {
        return {
          statusCode: exception.getStatus(),
          message: res,
          error: HttpStatus[exception.getStatus()] ?? 'Error',
        };
      }
      const obj = res as { message?: string | string[]; error?: string };
      return {
        statusCode: exception.getStatus(),
        message: obj.message ?? exception.message,
        error: obj.error ?? HttpStatus[exception.getStatus()] ?? 'Error',
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const prismaError = exception;
      switch (prismaError.code) {
        case 'P2002': {
          const target = prismaError.meta?.target as string[] | undefined;
          return {
            statusCode: HttpStatus.CONFLICT,
            message: `Unique constraint failed: ${target?.join(', ') ?? 'unknown'}`,
            error: 'Conflict',
          };
        }
        case 'P2025':
          return {
            statusCode: HttpStatus.NOT_FOUND,
            message: 'Resource not found',
            error: 'NotFound',
          };
        case 'P2003':
          return {
            statusCode: HttpStatus.BAD_REQUEST,
            message: 'Foreign key constraint failed',
            error: 'BadRequest',
          };
        default:
          return {
            statusCode: HttpStatus.BAD_REQUEST,
            message: prismaError.message,
            error: 'PrismaError',
          };
      }
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Invalid data provided to database',
        error: 'ValidationError',
      };
    }

    if (exception instanceof Error) {
      return {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: exception.message || 'Internal server error',
        error: 'InternalServerError',
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Unknown error',
      error: 'InternalServerError',
    };
  }
}
