import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { LoginDto, RefreshDto, SignupDto } from './auth.dto';
import { AuthService } from './auth.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('signup')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear cuenta con email + password' })
  @ApiBody({ type: SignupDto })
  async signup(@Body() body: SignupDto) {
    return this.auth.signup({
      email: body.email,
      password: body.password,
      name: body.name,
      cityCode: body.city_code ?? 'BAQ',
    });
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login con email + password' })
  @ApiBody({ type: LoginDto })
  async login(@Body() body: LoginDto) {
    return this.auth.login({ email: body.email, password: body.password });
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refrescar access token con refresh token' })
  @ApiBody({ type: RefreshDto })
  async refresh(@Body() body: RefreshDto) {
    return this.auth.refresh(body.refresh_token);
  }
}
