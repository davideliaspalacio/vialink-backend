import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { LocationDto } from '../common/dto/location.dto';

export class CreateWaitSessionDto {
  @ApiProperty({ type: () => LocationDto })
  @ValidateNested()
  @Type(() => LocationDto)
  location!: LocationDto;

  @ApiPropertyOptional({ format: 'uuid', description: 'Restringir el matching a una ruta específica' })
  @IsOptional()
  @IsUUID()
  route_id?: string;

  @ApiPropertyOptional({ default: 180, minimum: 30, maximum: 900 })
  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(900)
  notify_seconds_before?: number = 180;
}
