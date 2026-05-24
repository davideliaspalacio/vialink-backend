import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { BusesAtAddressDto, BusesAtPointDto } from './discovery.dto';
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
  @Post('buses-at-address')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      '🔍 Geocoding + buses-at-point en una sola llamada (ideal para el buscador del frontend)',
    description:
      'Toma una dirección libre tipo "Calle 84 con Cra 50", la geocodifica internamente (Mapbox + normalización colombiana), y devuelve las rutas + próximos buses en ese punto.\n\n' +
      'Combina dos round-trips (GET /geocode → POST /buses-at-point) en uno solo.\n\n' +
      'Respuesta: { destination: {query, formatted_address, location}, routes: [...] } — misma shape que /buses-at-point pero con metadata de la dirección resuelta.',
  })
  @ApiBody({ type: BusesAtAddressDto })
  async busesAtAddress(@Body() body: BusesAtAddressDto) {
    return this.discovery.getBusesAtAddress(
      body.address,
      body.user_location,
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
