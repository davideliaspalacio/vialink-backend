import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SignupDto {
  @ApiProperty({ example: 'maria@vialink.app' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'super-secret-123', minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  @ApiPropertyOptional({ example: 'María Pérez' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({ default: 'BAQ' })
  @IsOptional()
  @IsString()
  city_code?: string = 'BAQ';
}

export class LoginDto {
  @ApiProperty({ example: 'maria@vialink.app' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'super-secret-123' })
  @IsString()
  @MinLength(1)
  password!: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  @MinLength(10)
  refresh_token!: string;
}
