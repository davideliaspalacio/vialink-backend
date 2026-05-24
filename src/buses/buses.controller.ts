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
import { BusDetailsQueryDto } from './buses.dto';
import { BusesService } from './buses.service';

@ApiTags('buses')
@Controller('buses')
export class BusesController {
  constructor(
    private readonly buses: BusesService,
    private readonly busEngine: BusEngineService,
  ) {}

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
