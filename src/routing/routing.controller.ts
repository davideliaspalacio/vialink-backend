import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { RecommendRouteDto, WalkDirectionsDto } from './routing.dto';
import { RoutingService } from './routing.service';
import { WalkingService } from './walking.service';

@ApiTags('routing')
@Controller('routing')
export class RoutingController {
  constructor(
    private readonly routing: RoutingService,
    private readonly walking: WalkingService,
  ) {}

  @Public()
  @Post('recommend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      '🧭 Recomienda la mejor ruta en bus para ir de user_location a destination',
    description:
      'Dado dónde está el usuario y a dónde quiere ir, devuelve top N opciones rankeadas por tiempo total puerta-a-puerta.\n\n' +
      'Cada recomendación incluye:\n' +
      '  - Paradero de abordaje + cuántas cuadras camina hasta ahí\n' +
      '  - Bus específico (id, plate, ruta) y cuánto se demora en llegar\n' +
      '  - Tiempo en bus + paradero de descenso\n' +
      '  - Cuántas cuadras camina del descenso al destino\n' +
      '  - Polyline del tramo en bus para dibujar en el mapa\n\n' +
      'Si no hay rutas convenientes dentro de max_walking_m, devuelve recommendations: [].',
  })
  @ApiBody({ type: RecommendRouteDto })
  async recommend(@Body() body: RecommendRouteDto) {
    return this.routing.recommend({
      userLocation: body.user_location,
      destination: body.destination,
      maxWalkingM: body.max_walking_m ?? 500,
      maxAlternatives: body.max_alternatives ?? 3,
    });
  }

  @Public()
  @Post('walk')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '🚶 Polyline de caminata entre 2 puntos siguiendo calles reales',
    description:
      'Usa Mapbox Directions (profile walking) para devolver una ruta peatonal que sigue andenes/cebras/calles reales, en vez de línea recta.\n\n' +
      'Response: { polyline: [{lat,lng}, ...], distance_m, duration_seconds }.\n\n' +
      'Cache 24h (misma origin/destination → mismo polyline). Fallback gracioso a línea recta si Mapbox falla.',
  })
  @ApiBody({ type: WalkDirectionsDto })
  async walk(@Body() body: WalkDirectionsDto) {
    return this.walking.getWalkingRoute(body.from, body.to);
  }
}
