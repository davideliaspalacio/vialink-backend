import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { RecommendRouteDto } from './routing.dto';
import { RoutingService } from './routing.service';

@ApiTags('routing')
@Controller('routing')
export class RoutingController {
  constructor(private readonly routing: RoutingService) {}

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
}
