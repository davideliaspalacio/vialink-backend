import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { LocationDto } from '../common/dto/location.dto';

export class AssistantContextDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  current_trip_id?: string;
}

export class AskDto {
  @ApiProperty({
    example: '¿Cómo llego al Centro si voy de afán?',
    minLength: 1,
    maxLength: 500,
  })
  @IsString()
  @MaxLength(500)
  question!: string;

  @ApiPropertyOptional({ type: () => LocationDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocationDto)
  location?: LocationDto;

  @ApiPropertyOptional({ type: () => AssistantContextDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AssistantContextDto)
  context?: AssistantContextDto;
}

export class ListMessagesQueryDto {
  @ApiPropertyOptional({ default: 20, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  limit?: number = 20;
}
