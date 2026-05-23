import { Module } from '@nestjs/common';
import { AssistantModule } from '../assistant/assistant.module';
import { DiscoveryModule } from '../discovery/discovery.module';
import { IncidentsModule } from '../incidents/incidents.module';
import { TripsModule } from '../trips/trips.module';
import { AgentEngineService } from './agent-engine.service';
import { SimulatorController } from './simulator.controller';
import { SimulatorService } from './simulator.service';

@Module({
  imports: [DiscoveryModule, TripsModule, IncidentsModule, AssistantModule],
  controllers: [SimulatorController],
  providers: [SimulatorService, AgentEngineService],
  exports: [SimulatorService],
})
export class SimulatorModule {}
