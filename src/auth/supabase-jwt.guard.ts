import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { AuthService } from './auth.service';

/**
 * Global guard: requires `Authorization: Bearer <jwt>` on every request,
 * unless the handler/controller is marked with `@Public()`.
 *
 * Sets `req.user = { id, email, name }` on success.
 */
@Injectable()
export class SupabaseJwtGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    // Skip for @Public() handlers/controllers and for WebSocket handlers
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;
    if (ctx.getType() !== 'http') return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const auth = req.headers.authorization;
    if (!auth || !auth.toLowerCase().startsWith('bearer ')) {
      throw new UnauthorizedException('Missing Bearer token');
    }
    const token = auth.slice(7).trim();
    if (!token) {
      throw new UnauthorizedException('Empty Bearer token');
    }

    const user = await this.authService.verifyAccessToken(token);
    (req as Request & { user: typeof user }).user = user;
    return true;
  }
}
