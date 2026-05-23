import { Module } from '@nestjs/common';
import { BusEngineService } from './bus-engine.service';
import { BusesController } from './buses.controller';
import { BusesService } from './buses.service';

@Module({
  controllers: [BusesController],
  providers: [BusesService, BusEngineService],
  exports: [BusesService, BusEngineService],
})
export class BusesModule {}
