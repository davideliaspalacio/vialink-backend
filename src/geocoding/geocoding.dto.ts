import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class GeocodeQueryDto {
  @ApiProperty({
    example: 'Calle 84 con Cra 50',
    description: 'Direccion libre, esquina, o referencia. Tolerante a typos.',
    minLength: 2,
    maxLength: 120,
  })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  q!: string;

  @ApiPropertyOptional({
    example: 11.0186,
    description: 'Latitud de proximidad para sesgar resultados (ej. ubicación del usuario)',
  })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  @Type(() => Number)
  lat?: number;

  @ApiPropertyOptional({
    example: -74.8499,
    description: 'Longitud de proximidad. Acompaña a lat.',
  })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  @Type(() => Number)
  lng?: number;

  @ApiPropertyOptional({ default: 5, minimum: 1, maximum: 10 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  @Type(() => Number)
  limit?: number = 5;
}
