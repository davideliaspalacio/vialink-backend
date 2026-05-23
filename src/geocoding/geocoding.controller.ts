import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { GeocodeQueryDto } from './geocoding.dto';
import { GeocodingService } from './geocoding.service';

@ApiTags('geocoding')
@Controller('geocode')
export class GeocodingController {
  constructor(private readonly geocoding: GeocodingService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Geocoding de direcciones libres (Nominatim, gratis, sin token)',
    description:
      'Convierte texto libre (ej. "Calle 84 con Cra 50") a coordenadas. ' +
      'Sesgado a Barranquilla. Cache 1h. Respeta rate-limit 1 req/seg de Nominatim. ' +
      'Si el resultado está cacheado, latencia ~5ms. Si va a Nominatim, ~800-1500ms.',
  })
  async geocode(@Query() q: GeocodeQueryDto) {
    const proximity =
      q.lat != null && q.lng != null ? { lat: q.lat, lng: q.lng } : undefined;
    return this.geocoding.geocode({
      query: q.q,
      proximity,
      limit: q.limit ?? 5,
    });
  }

  @Public()
  @Get('cache-stats')
  @ApiOperation({ summary: 'Hit rate del cache de geocoding (debug)' })
  cacheStats() {
    return this.geocoding.getStats();
  }
}
