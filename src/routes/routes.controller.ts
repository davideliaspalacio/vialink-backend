import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import {
  ListRoutesQueryDto,
  NearbyRoutesQueryDto,
} from './routes.dto';
import { RoutesService } from './routes.service';

@ApiTags('routes')
@Controller('routes')
export class RoutesController {
  constructor(private readonly routes: RoutesService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Listar rutas activas en una ciudad' })
  async list(@Query() q: ListRoutesQueryDto) {
    return this.routes.list(q.city ?? 'BAQ', q.mode);
  }

  @Public()
  @Get('nearby')
  @ApiOperation({
    summary: 'Rutas cuyo corridor pasa cerca de un punto (versión ligera)',
    description:
      'Para versión ligera sin info de buses. Si quieres ETAs use POST /buses-at-point',
  })
  async nearby(@Query() q: NearbyRoutesQueryDto) {
    return this.routes.findNearby({
      lat: q.lat,
      lng: q.lng,
      radius_m: q.radius_m ?? 100,
      cityCode: 'BAQ',
    });
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Detalle de una ruta + landmarks ordenados por recorrido' })
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.routes.findById(id);
  }

  @Public()
  @Get(':id/corridor.geojson')
  @ApiOperation({
    summary: 'Corridor de la ruta como GeoJSON LineString',
    description: 'Listo para `L.geoJSON()` (Leaflet) o `addSource` (Mapbox)',
  })
  async corridor(@Param('id', ParseUUIDPipe) id: string) {
    return this.routes.corridorGeoJson(id);
  }

  @Public()
  @Get(':id/buses')
  @ApiOperation({ summary: 'Buses activos en una ruta (snapshot para inicializar el mapa)' })
  async buses(@Param('id', ParseUUIDPipe) id: string) {
    return this.routes.buses(id);
  }
}
