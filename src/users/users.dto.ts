import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FavoriteTarget } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateFavoriteDto {
  @ApiProperty({ enum: FavoriteTarget, example: FavoriteTarget.LANDMARK })
  @IsEnum(FavoriteTarget)
  target_type!: FavoriteTarget;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  target_id!: string;

  @ApiPropertyOptional({ example: 'Casa' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  alias?: string;
}
