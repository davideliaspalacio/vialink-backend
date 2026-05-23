import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { FeedService } from './feed.service';
import { MetricsService } from './metrics.service';

@Module({
  controllers: [AdminController],
  providers: [MetricsService, FeedService],
  exports: [MetricsService, FeedService],
})
export class AdminModule {}
