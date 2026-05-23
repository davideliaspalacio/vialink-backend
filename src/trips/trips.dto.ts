import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TripStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { LocationDto } from '../common/dto/location.dto';

export class CreateTripDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  route_id!: string;

  @ApiProperty({ type: () => LocationDto })
  @ValidateNested()
  @Type(() => LocationDto)
  boarding_location!: LocationDto;

  @ApiProperty({ type: () => LocationDto })
  @ValidateNested()
  @Type(() => LocationDto)
  dropoff_location!: LocationDto;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  boarding_landmark_id?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  dropoff_landmark_id?: string;
}

export class UpdateTripStatusDto {
  @ApiProperty({ enum: ['COMPLETED', 'CANCELLED'] })
  @IsEnum(TripStatus)
  status!: 'COMPLETED' | 'CANCELLED';
}

export class RateTripDto {
  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  stars!: number;

  @ApiPropertyOptional({ maxLength: 280 })
  @IsOptional()
  @IsString()
  @MaxLength(280)
  comment?: string;
}
