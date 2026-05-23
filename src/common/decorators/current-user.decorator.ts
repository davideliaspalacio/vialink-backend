import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Pulls the authenticated user (set by SupabaseJwtGuard) from the request.
 * Usage: someHandler(@CurrentUser() user: AuthenticatedUser) {}
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  name?: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser | undefined => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as AuthenticatedUser | undefined;
  },
);
