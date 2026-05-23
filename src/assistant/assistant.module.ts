import { Module } from '@nestjs/common';
import { DiscoveryModule } from '../discovery/discovery.module';
import { LandmarksModule } from '../landmarks/landmarks.module';
import { RoutesModule } from '../routes/routes.module';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { AssistantToolsService } from './tools/assistant-tools.service';

@Module({
  // GeocodingModule es @Global() así que GeocodingService está disponible sin import explícito
  imports: [LandmarksModule, RoutesModule, DiscoveryModule],
  controllers: [AssistantController],
  providers: [AssistantService, AssistantToolsService],
  exports: [AssistantService],
})
export class AssistantModule {}
