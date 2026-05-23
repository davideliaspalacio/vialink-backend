import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class NearbyLandmarksQueryDto {
  @ApiProperty({ example: 11.0186 })
  @IsNumber()
  @Min(-90)
  @Max(90)
  @Type(() => Number)
  lat!: number;

  @ApiProperty({ example: -74.8499 })
  @IsNumber()
  @Min(-180)
  @Max(180)
  @Type(() => Number)
  lng!: number;

  @ApiPropertyOptional({ default: 1000, minimum: 50, maximum: 5000 })
  @IsOptional()
  @IsInt()
  @Min(50)
  @Max(5000)
  @Type(() => Number)
  radius_m?: number = 1000;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 20;
}

export class SearchLandmarksQueryDto {
  @ApiProperty({ example: 'uninorte', minLength: 1, maxLength: 80 })
  @IsString()
  @MaxLength(80)
  q!: string;

  @ApiPropertyOptional({ default: 'BAQ' })
  @IsOptional()
  @IsString()
  city?: string = 'BAQ';

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  @Type(() => Number)
  limit?: number = 10;
}
