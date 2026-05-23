import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IncidentType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { LocationDto } from '../common/dto/location.dto';

export class CreateIncidentDto {
  @ApiProperty({ enum: IncidentType })
  @IsEnum(IncidentType)
  type!: IncidentType;

  @ApiProperty({ type: () => LocationDto })
  @ValidateNested()
  @Type(() => LocationDto)
  location!: LocationDto;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  route_id?: string;

  @ApiPropertyOptional({ maxLength: 280 })
  @IsOptional()
  @IsString()
  @MaxLength(280)
  description?: string;
}

export class NearbyIncidentsQueryDto {
  @ApiProperty({ example: 11.0 })
  @IsNumber()
  @Min(-90)
  @Max(90)
  @Type(() => Number)
  lat!: number;

  @ApiProperty({ example: -74.8 })
  @IsNumber()
  @Min(-180)
  @Max(180)
  @Type(() => Number)
  lng!: number;

  @ApiPropertyOptional({ default: 1000, minimum: 100, maximum: 5000 })
  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(5000)
  @Type(() => Number)
  radius_m?: number = 1000;

  @ApiPropertyOptional({ default: 60, minimum: 1, maximum: 1440 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  @Type(() => Number)
  since_minutes?: number = 60;
}
