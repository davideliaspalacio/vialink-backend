import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, Max, Min, ValidateNested } from 'class-validator';

/**
 * Standard geographic coordinate used across the entire API.
 * Always {lat, lng} — never raw GeoJSON [lng, lat] order in REST endpoints.
 */
export class LocationDto {
  @ApiProperty({ example: 11.0041, description: 'Latitude in WGS84' })
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @ApiProperty({ example: -74.807, description: 'Longitude in WGS84' })
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;
}

export class LocationContainerDto {
  @ApiProperty({ type: () => LocationDto })
  @ValidateNested()
  @Type(() => LocationDto)
  location!: LocationDto;
}
