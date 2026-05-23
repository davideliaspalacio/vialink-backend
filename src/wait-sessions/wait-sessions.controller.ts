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
import { Public } from '../common/decorators/public.decorator';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { CreateWaitSessionDto } from './wait-sessions.dto';
import { WaitSessionMatcherService } from './wait-session-matcher.service';
import { WaitSessionsService } from './wait-sessions.service';

@ApiTags('wait-sessions')
@ApiBearerAuth('supabase-jwt')
@Controller('wait-sessions')
export class WaitSessionsController {
  constructor(
    private readonly waitSessions: WaitSessionsService,
    private readonly matcher: WaitSessionMatcherService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Crear pin de espera — recibirás WS alert cuando bus esté cerca',
  })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateWaitSessionDto,
  ) {
    return this.waitSessions.create({
      userId: user.id,
      location: body.location,
      routeId: body.route_id,
      notifySecondsBefore: body.notify_seconds_before,
    });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Cancelar pin de espera' })
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.waitSessions.cancel(id, user.id);
  }

  @Public()
  @Get('matcher/stats')
  @ApiOperation({ summary: 'Matcher debug stats' })
  matcherStats() {
    return this.matcher.getStats();
  }
}
