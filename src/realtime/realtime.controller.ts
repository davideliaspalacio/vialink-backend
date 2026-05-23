import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { RealtimeGateway } from './realtime.gateway';

@ApiTags('realtime')
@Controller('realtime')
export class RealtimeController {
  constructor(private readonly gateway: RealtimeGateway) {}

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'WebSocket health (connections per room)' })
  health() {
    return this.gateway.getStats();
  }
}
