import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RoutingController } from './routing.controller';
import { RoutingService } from './routing.service';
import { WalkingService } from './walking.service';

@Module({
  imports: [PrismaModule],
  controllers: [RoutingController],
  providers: [RoutingService, WalkingService],
  exports: [RoutingService, WalkingService],
})
export class RoutingModule {}
