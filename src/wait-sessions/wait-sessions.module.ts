import { Module } from '@nestjs/common';
import { WaitSessionMatcherService } from './wait-session-matcher.service';
import { WaitSessionsController } from './wait-sessions.controller';
import { WaitSessionsService } from './wait-sessions.service';

@Module({
  controllers: [WaitSessionsController],
  providers: [WaitSessionsService, WaitSessionMatcherService],
  exports: [WaitSessionsService],
})
export class WaitSessionsModule {}
