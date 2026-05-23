import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { FeedQueryDto } from './admin.dto';
import { FeedService } from './feed.service';
import { MetricsService } from './metrics.service';

/**
 * Vialink Admin — for the pitch view.
 *
 * Endpoints marked @Public for now so the admin frontend can consume without
 * a fancy auth flow during the demo. In production we'd gate behind a role.
 */
@ApiTags('admin')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly feed: FeedService,
  ) {}

  @Public()
  @Get('metrics')
  @ApiOperation({ summary: 'Snapshot puntual de métricas (alternativa a WS metrics_update)' })
  async getMetrics() {
    const cached = this.metrics.getLastSnapshot();
    if (cached) return { metrics: cached, source: 'cached_2s' };
    const fresh = await this.metrics.snapshot();
    return { metrics: fresh, source: 'fresh' };
  }

  @Public()
  @Get('feed')
  @ApiOperation({
    summary: 'Feed unificado de actividad reciente (trips, incidents, AI, ratings, agents)',
  })
  async getFeed(@Query() q: FeedQueryDto) {
    return this.feed.list({
      limit: q.limit ?? 50,
      since: q.since ? new Date(q.since) : undefined,
    });
  }
}
