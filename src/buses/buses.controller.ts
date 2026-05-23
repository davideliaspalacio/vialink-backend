import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { BusEngineService } from './bus-engine.service';

@ApiTags('buses')
@Controller('buses')
export class BusesController {
  constructor(private readonly busEngine: BusEngineService) {}

  @Public()
  @Get('engine/status')
  @ApiOperation({ summary: 'BusEngine status (debug)' })
  engineStatus() {
    return this.busEngine.getStatus();
  }
}
