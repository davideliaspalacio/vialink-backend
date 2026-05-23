import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { StartSimulatorDto } from './simulator.dto';
import { SimulatorService } from './simulator.service';

@ApiTags('admin')
@Controller('admin/simulator')
export class SimulatorController {
  constructor(private readonly simulator: SimulatorService) {}

  @Public()
  @Post('start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Iniciar simulador con N agentes (admin)',
    description:
      'Por defecto 100 agentes. Máximo 1000. Si ya hay agentes en DB, los reutiliza; solo crea los que falten para llegar al agent_count solicitado.',
  })
  async start(@Body() body: StartSimulatorDto) {
    return this.simulator.start({ agent_count: body.agent_count ?? 100 });
  }

  @Public()
  @Post('stop')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pausar el simulador (los agentes quedan en DB)' })
  async stop() {
    return this.simulator.stop();
  }

  @Public()
  @Post('reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Borrar TODOS los agentes + eventos del simulador (destructivo)',
    description:
      'Para usar entre demos: limpia la DB para tener un estado fresco. También elimina sus trips, ratings, incidents, etc.',
  })
  async reset() {
    return this.simulator.reset();
  }

  @Public()
  @Get('status')
  @ApiOperation({ summary: 'Estado del simulador (running, agentes, métricas)' })
  async status() {
    return this.simulator.getStatus();
  }
}
