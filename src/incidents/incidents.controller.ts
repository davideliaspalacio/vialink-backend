import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import {
  CreateIncidentDto,
  NearbyIncidentsQueryDto,
} from './incidents.dto';
import { IncidentsService } from './incidents.service';

@ApiTags('incidents')
@Controller('incidents')
export class IncidentsController {
  constructor(private readonly incidents: IncidentsService) {}

  @ApiBearerAuth('supabase-jwt')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Reportar incidencia (trancón, bus lleno, no pasa)',
  })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateIncidentDto,
  ) {
    return this.incidents.report({
      userId: user.id,
      type: body.type,
      location: body.location,
      routeId: body.route_id,
      description: body.description,
      cityCode: 'BAQ',
    });
  }

  @Public()
  @Get('nearby')
  @ApiOperation({ summary: 'Incidentes cerca de un punto, recientes' })
  async nearby(@Query() q: NearbyIncidentsQueryDto) {
    return this.incidents.nearby({
      location: { lat: q.lat, lng: q.lng },
      radiusM: q.radius_m ?? 1000,
      sinceMinutes: q.since_minutes ?? 60,
    });
  }
}
