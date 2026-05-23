import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import {
  NearbyLandmarksQueryDto,
  SearchLandmarksQueryDto,
} from './landmarks.dto';
import { LandmarksService } from './landmarks.service';

@ApiTags('landmarks')
@Controller('landmarks')
export class LandmarksController {
  constructor(private readonly landmarks: LandmarksService) {}

  @Public()
  @Get('nearby')
  @ApiOperation({
    summary: 'Lugares populares cerca de un punto',
    description:
      'Para anclajes visuales en el mapa. Ordenado por distancia. Útil para el bottom sheet del frontend.',
  })
  async nearby(@Query() q: NearbyLandmarksQueryDto) {
    return this.landmarks.findNearby({
      lat: q.lat,
      lng: q.lng,
      radius_m: q.radius_m ?? 1000,
      limit: q.limit ?? 20,
    });
  }

  @Public()
  @Get('search')
  @ApiOperation({
    summary: 'Buscar lugares por nombre (fuzzy con pg_trgm)',
    description: 'Tolerante a typos leves. Ej: "uninorte", "olimpica", "cari"',
  })
  async search(@Query() q: SearchLandmarksQueryDto) {
    return this.landmarks.search({
      q: q.q,
      cityCode: q.city,
      limit: q.limit ?? 10,
    });
  }

  @Public()
  @Get(':id')
  @ApiOperation({
    summary: 'Detalle de un lugar + rutas que pasan cerca',
  })
  async byId(@Param('id', ParseUUIDPipe) id: string) {
    return this.landmarks.findById(id);
  }
}
