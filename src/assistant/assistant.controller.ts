import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { AskDto, ListMessagesQueryDto } from './assistant.dto';
import { AssistantService } from './assistant.service';

@ApiTags('assistant')
@ApiBearerAuth('supabase-jwt')
@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Post('ask')
  // Tight rate limit: Claude is expensive. 5 requests / minute per user.
  @Throttle({
    default: {
      ttl: 60_000,
      limit: Number(process.env.ASSISTANT_THROTTLE_LIMIT ?? 5),
    },
  })
  @ApiOperation({
    summary: '⭐ Preguntar al asistente en español natural (Claude Haiku 4.5)',
    description:
      'Tools internas (function calling): find_landmark, find_routes_near, get_buses_at_point, calculate_trip. ' +
      'Retorna respuesta + suggested_action opcional para CTA en el frontend.',
  })
  async ask(@CurrentUser() user: AuthenticatedUser, @Body() body: AskDto) {
    return this.assistant.ask({
      userId: user.id,
      question: body.question,
      location: body.location,
      currentTripId: body.context?.current_trip_id,
    });
  }

  @Get('messages')
  @ApiOperation({ summary: 'Historial de conversación' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() q: ListMessagesQueryDto,
  ) {
    return this.assistant.listMessages(user.id, q.limit ?? 20);
  }
}
