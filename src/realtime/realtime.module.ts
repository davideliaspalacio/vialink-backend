import { Global, Module } from '@nestjs/common';
import { RealtimeEventBus } from './realtime-event-bus.service';
import { RealtimeController } from './realtime.controller';
import { RealtimeGateway } from './realtime.gateway';

@Global()
@Module({
  controllers: [RealtimeController],
  providers: [RealtimeGateway, RealtimeEventBus],
  exports: [RealtimeGateway, RealtimeEventBus],
})
export class RealtimeModule {}
