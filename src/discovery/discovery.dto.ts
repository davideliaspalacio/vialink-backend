import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
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

export class BusesAtAddressDto {
  @ApiProperty({
    example: 'Calle 84 con Cra 50',
    description: 'Direccion libre. El backend la geocodifica internamente.',
    minLength: 2,
    maxLength: 120,
  })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  address!: string;

  @ApiPropertyOptional({
    type: () => LocationDto,
    description: 'Ubicacion actual del usuario (sesga geocoding y permite ordenar resultados por proximidad)',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocationDto)
  user_location?: LocationDto;

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
