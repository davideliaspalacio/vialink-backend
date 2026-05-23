import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import {
  CreateTripDto,
  RateTripDto,
  UpdateTripStatusDto,
} from './trips.dto';
import { TripsService } from './trips.service';

@ApiTags('trips')
@ApiBearerAuth('supabase-jwt')
@Controller('trips')
export class TripsController {
  constructor(private readonly trips: TripsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Iniciar un viaje' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateTripDto,
  ) {
    return this.trips.createTrip({
      userId: user.id,
      routeId: body.route_id,
      boardingLocation: body.boarding_location,
      dropoffLocation: body.dropoff_location,
      boardingLandmarkId: body.boarding_landmark_id,
      dropoffLandmarkId: body.dropoff_landmark_id,
    });
  }

  @Get('active')
  @ApiOperation({ summary: 'Mi viaje activo (null si no hay)' })
  async active(@CurrentUser() user: AuthenticatedUser) {
    return this.trips.getActive(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de un viaje' })
  async detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.trips.findById(id, user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Completar o cancelar viaje' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateTripStatusDto,
  ) {
    return this.trips.updateStatus(id, user.id, body.status);
  }

  @Post(':id/rating')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Calificar un viaje completado' })
  async rate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RateTripDto,
  ) {
    return this.trips.rate(id, user.id, body.stars, body.comment);
  }
}
