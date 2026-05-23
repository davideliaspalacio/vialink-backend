import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { RouteMode } from '@prisma/client';

export class ListRoutesQueryDto {
  @ApiPropertyOptional({ default: 'BAQ' })
  @IsOptional()
  @IsString()
  city?: string = 'BAQ';

  @ApiPropertyOptional({ enum: RouteMode })
  @IsOptional()
  @IsEnum(RouteMode)
  mode?: RouteMode;
}

export class NearbyRoutesQueryDto {
  @ApiPropertyOptional({ example: 11.0186 })
  @IsNumber()
  @Min(-90)
  @Max(90)
  @Type(() => Number)
  lat!: number;

  @ApiPropertyOptional({ example: -74.8499 })
  @IsNumber()
  @Min(-180)
  @Max(180)
  @Type(() => Number)
  lng!: number;

  @ApiPropertyOptional({ default: 100, minimum: 10, maximum: 1000 })
  @IsOptional()
  @IsNumber()
  @Min(10)
  @Max(1000)
  @Type(() => Number)
  radius_m?: number = 100;
}
