import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOkResponse({
    description: 'Service health check (DB connectivity + uptime)',
  })
  async check() {
    let db: { ok: boolean; latencyMs?: number; error?: string };
    try {
      const ping = await this.prisma.ping();
      db = { ok: true, latencyMs: ping.latencyMs };
    } catch (err) {
      db = { ok: false, error: (err as Error).message };
    }

    return {
      status: db.ok ? 'ok' : 'degraded',
      service: 'vialink-backend',
      version: process.env.npm_package_version ?? '0.0.1',
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
      checks: { db },
    };
  }
}
