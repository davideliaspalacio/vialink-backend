import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { BusEngineService } from './bus-engine.service';
import { BusDetailsQueryDto, ListBusesQueryDto } from './buses.dto';
import { BusesService } from './buses.service';

@ApiTags('buses')
@Controller('buses')
export class BusesController {
  constructor(
    private readonly buses: BusesService,
    private readonly busEngine: BusEngineService,
  ) {}

  @Public()
  @Get()
  @ApiOperation({
    summary:
      '📦 Snapshot inicial de TODOS los buses IN_SERVICE en una ciudad',
    description:
      'Devuelve todos los buses activos en una sola llamada. Útil para ' +
      'que el frontend popule el mapa al cargar, antes de empezar a recibir ' +
      'updates por WebSocket bus_position. Cada bus trae id, plate, ruta, ' +
      'ubicación, heading, speed.',
  })
  async list(@Query() q: ListBusesQueryDto) {
    const raw = await this.buses.listAllInService(q.city ?? 'BAQ');
    return {
      city: q.city ?? 'BAQ',
      count: raw.length,
      buses: raw.map((b) => ({
        id: b.id,
        plate: b.plate,
        route_id: b.route_id,
        route_code: b.route_code,
        location: { lat: b.lat, lng: b.lng },
        heading: b.heading,
        speed_kmh: b.speed_kmh,
        fraction_of_corridor: b.fraction_of_corridor,
        status: b.status,
        last_seen_at: b.last_seen_at,
      })),
    };
  }

  @Public()
  @Get(':id/details')
  @ApiOperation({
    summary:
      '🎯 Detalle completo del bus (para el modal "click en bus" del frontend)',
    description:
      'Devuelve en una sola llamada: bus + ruta + polyline GeoJSON + ' +
      'próximo landmark + (opcional) ETA al usuario si pasa lat/lng. ' +
      'Si el bus no está IN_SERVICE devuelve 410 Gone para que el frontend ' +
      'muestre "Bus completó recorrido". Cache 1s.',
  })
  async details(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: BusDetailsQueryDto,
  ) {
    const userLocation =
      q.lat != null && q.lng != null ? { lat: q.lat, lng: q.lng } : undefined;
    return this.buses.getBusDetails(id, userLocation);
  }

  @Public()
  @Get('engine/status')
  @ApiOperation({ summary: 'BusEngine status (debug)' })
  engineStatus() {
    return this.busEngine.getStatus();
  }
}
