import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AdminModule } from './admin/admin.module';
import { AssistantModule } from './assistant/assistant.module';
import { AuthModule } from './auth/auth.module';
import { BusesModule } from './buses/buses.module';
import { CitiesModule } from './cities/cities.module';
import { validateEnv } from './config/configuration';
import { DiscoveryModule } from './discovery/discovery.module';
import { GeocodingModule } from './geocoding/geocoding.module';
import { HealthModule } from './health/health.module';
import { IncidentsModule } from './incidents/incidents.module';
import { LandmarksModule } from './landmarks/landmarks.module';
import { PrismaModule } from './prisma/prisma.module';
import { RealtimeModule } from './realtime/realtime.module';
import { RoutesModule } from './routes/routes.module';
import { SimulatorModule } from './simulator/simulator.module';
import { TripsModule } from './trips/trips.module';
import { UsersModule } from './users/users.module';
import { WaitSessionsModule } from './wait-sessions/wait-sessions.module';

@Module({
  imports: [
    // ===== Infrastructure =====
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    LoggerModule.forRootAsync({
      useFactory: () => ({
        pinoHttp: {
          level: process.env.LOG_LEVEL ?? 'info',
          transport:
            process.env.NODE_ENV === 'development'
              ? {
                  target: 'pino-pretty',
                  options: {
                    singleLine: true,
                    colorize: true,
                    translateTime: 'SYS:HH:MM:ss',
                  },
                }
              : undefined,
          redact: ['req.headers.authorization', 'req.headers.cookie'],
          customProps: () => ({ service: 'vialink-backend' }),
        },
      }),
    }),
    ThrottlerModule.forRoot([
      {
        ttl: Number(process.env.THROTTLE_TTL_MS ?? 60_000),
        limit: Number(process.env.THROTTLE_LIMIT ?? 120),
      },
    ]),
    EventEmitterModule.forRoot({ wildcard: false, maxListeners: 50 }),
    ScheduleModule.forRoot(),
    PrismaModule,

    // ===== Core domain modules (Bloque 2) =====
    CitiesModule, // multi-city resolver
    RealtimeModule, // WS gateway + event bus (global)
    GeocodingModule, // Nominatim geocoding (global) — usado por discovery, assistant tools
    LandmarksModule,
    RoutesModule,
    BusesModule, // includes BusEngine (moves buses every tick)
    DiscoveryModule, // POST /buses-at-point ⭐

    // ===== Auth + users (Bloque 3) =====
    AuthModule, // global JWT guard + Supabase auth proxy
    UsersModule, // /me, /me/favorites

    // ===== Trips + Wait + Incidents (Bloque 4) =====
    TripsModule,
    WaitSessionsModule, // includes WaitSessionMatcher scheduled every 5s
    IncidentsModule,

    // ===== Asistente Claude (Bloque 5) =====
    AssistantModule, // ⭐ diferenciador #1 — Claude Haiku 4.5 con function calling

    // ===== Admin metrics + feed (Bloque 7) =====
    AdminModule, // GET /admin/metrics, /admin/feed + MetricsService scheduled 2s

    // ===== Simulador 500 agentes (Bloque 6) =====
    SimulatorModule, // POST /admin/simulator/start, /stop, /reset, GET /status

    // ===== Misc =====
    HealthModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
