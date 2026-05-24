import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class ListBusesQueryDto {
  @ApiPropertyOptional({ default: 'BAQ' })
  @IsOptional()
  @IsString()
  city?: string = 'BAQ';
}

export class BusDetailsQueryDto {
  @ApiPropertyOptional({
    example: 11.0186,
    description: 'Latitud del usuario (opcional). Si se proporciona junto con lng, el response incluye eta_to_user.',
  })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  @Type(() => Number)
  lat?: number;

  @ApiPropertyOptional({
    example: -74.8499,
    description: 'Longitud del usuario (opcional). Debe acompañar a lat.',
  })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  @Type(() => Number)
  lng?: number;
}
