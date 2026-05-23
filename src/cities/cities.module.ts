import { Global, Module } from '@nestjs/common';
import { CitiesService } from './cities.service';

@Global()
@Module({
  providers: [CitiesService],
  exports: [CitiesService],
})
export class CitiesModule {}
