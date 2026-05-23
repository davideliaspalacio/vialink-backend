import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';
import { LocationDto } from '../common/dto/location.dto';

export class BusesAtPointDto {
  @ApiProperty({ type: () => LocationDto })
  @ValidateNested()
  @Type(() => LocationDto)
  location!: LocationDto;

  @ApiPropertyOptional({ default: 100, minimum: 10, maximum: 500 })
  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(500)
  radius_m?: number = 100;

  @ApiPropertyOptional({ default: 'BAQ' })
  @IsOptional()
  @IsString()
  city?: string = 'BAQ';
}
