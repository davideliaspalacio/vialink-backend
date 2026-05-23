import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { BusesAtPointDto } from './discovery.dto';
import { DiscoveryService } from './discovery.service';

@ApiTags('discovery')
@Controller()
export class DiscoveryController {
  constructor(private readonly discovery: DiscoveryService) {}

  @Public()
  @Post('buses-at-point')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '⭐ Endpoint estrella: rutas + próximos buses en cualquier punto',
    description:
      'Recibe una ubicación arbitraria (no necesariamente un paradero) y devuelve qué rutas pasan cerca con los próximos buses y su ETA hasta ese punto exacto.\n\nCache: TTL 3s + dedupe por punto redondeado.',
  })
  @ApiBody({ type: BusesAtPointDto })
  async busesAtPoint(@Body() body: BusesAtPointDto) {
    return this.discovery.getBusesAtPoint(
      body.location,
      body.radius_m ?? 100,
      body.city ?? 'BAQ',
    );
  }

  @Public()
  @Get('discovery/cache-stats')
  @ApiOperation({ summary: 'Cache hit/miss stats (debug)' })
  cacheStats() {
    return this.discovery.getCacheStats();
  }
}
