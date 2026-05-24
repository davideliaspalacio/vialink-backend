import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min, ValidateNested } from 'class-validator';
import { LocationDto } from '../common/dto/location.dto';

export class RecommendRouteDto {
  @ApiProperty({
    type: () => LocationDto,
    description: 'Ubicación actual del usuario (de donde sale).',
  })
  @ValidateNested()
  @Type(() => LocationDto)
  user_location!: LocationDto;

  @ApiProperty({
    type: () => LocationDto,
    description: 'Destino al que el usuario quiere llegar.',
  })
  @ValidateNested()
  @Type(() => LocationDto)
  destination!: LocationDto;

  @ApiPropertyOptional({
    default: 500,
    minimum: 100,
    maximum: 2000,
    description:
      'Distancia máxima de caminata aceptable en cualquiera de los dos tramos (user→paradero o paradero→destino). 500m = ~5 cuadras en Barranquilla.',
  })
  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(2000)
  max_walking_m?: number = 500;

  @ApiPropertyOptional({
    default: 3,
    minimum: 1,
    maximum: 5,
    description: 'Cuántas alternativas devolver (top N por tiempo total).',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  max_alternatives?: number = 3;
}
