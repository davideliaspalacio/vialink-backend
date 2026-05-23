import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { CreateFavoriteDto } from './users.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth('supabase-jwt')
@Controller('me')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'Mi perfil' })
  async me(@CurrentUser() user: AuthenticatedUser) {
    return this.users.getMe(user.id);
  }

  @Get('favorites')
  @ApiOperation({ summary: 'Mis favoritos (landmarks + rutas)' })
  async listFavorites(@CurrentUser() user: AuthenticatedUser) {
    return this.users.listFavorites(user.id);
  }

  @Post('favorites')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Agregar favorito (landmark o ruta)' })
  async createFavorite(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateFavoriteDto,
  ) {
    return this.users.createFavorite({
      userId: user.id,
      targetType: body.target_type,
      targetId: body.target_id,
      alias: body.alias,
    });
  }

  @Delete('favorites/:id')
  @ApiOperation({ summary: 'Eliminar favorito por id' })
  async deleteFavorite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.users.deleteFavorite(user.id, id);
  }
}
