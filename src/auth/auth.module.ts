import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SupabaseClientFactory } from './supabase.client';
import { SupabaseJwtGuard } from './supabase-jwt.guard';

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    SupabaseClientFactory,
    AuthService,
    SupabaseJwtGuard,
    // Mount the JWT guard globally — endpoints can opt out with @Public()
    {
      provide: APP_GUARD,
      useClass: SupabaseJwtGuard,
    },
  ],
  exports: [AuthService, SupabaseClientFactory],
})
export class AuthModule {}
