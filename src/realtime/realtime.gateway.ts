import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import {
  InternalEvents,
  WsEvents,
  type AgentActionEvent,
  type BusPositionEvent,
  type IncidentReportedEvent,
  type MetricsUpdateEvent,
  type TripUpdateEvent,
  type WaitSessionAlertEvent,
} from './realtime-events';

/**
 * Vialink — Socket.io gateway for realtime events.
 *
 * Rooms (clients subscribe via the `subscribe` message):
 *   - `admin`         → all events (used by admin/pitch view)
 *   - `city:<CODE>`   → bus positions + incidents in that city
 *   - `bus:<id>`      → granular per-bus updates (e.g. tracking a specific bus)
 *   - `trip:<id>`     → updates for a single trip
 *   - `wait:<id>`     → alerts for a wait session
 */
@WebSocketGateway({
  path: '/realtime',
  cors: { origin: true, credentials: true },
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  // ============ Connection lifecycle ============

  handleConnection(client: Socket) {
    this.logger.log(
      `🔌 Client connected: ${client.id} (total: ${this.server.engine.clientsCount})`,
    );
  }

  handleDisconnect(client: Socket) {
    this.logger.log(
      `❌ Client disconnected: ${client.id} (total: ${this.server.engine.clientsCount})`,
    );
  }

  // ============ Client → server messages ============

  @SubscribeMessage('subscribe')
  handleSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { room: string },
  ): { ok: boolean; room: string } {
    const room = String(body?.room ?? '').trim();
    if (!room || room.length > 100) {
      return { ok: false, room };
    }
    // TODO Bloque 3: validate `admin` room requires auth
    void client.join(room);
    this.logger.debug(`Client ${client.id} joined room "${room}"`);
    return { ok: true, room };
  }

  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { room: string },
  ): { ok: boolean; room: string } {
    const room = String(body?.room ?? '').trim();
    void client.leave(room);
    return { ok: true, room };
  }

  @SubscribeMessage('ping')
  handlePing(): { pong: number } {
    return { pong: Date.now() };
  }

  // ============ EventBus listeners → broadcast to rooms ============

  @OnEvent(InternalEvents.BusPosition)
  onBusPosition(e: BusPositionEvent) {
    // Always broadcast to admin and the city room; also fan out per-bus subscribers
    this.server
      .to(['admin', `city:${e.cityCode}`, `bus:${e.busId}`])
      .emit(WsEvents.BusPosition, { type: WsEvents.BusPosition, ...e });
  }

  @OnEvent(InternalEvents.TripUpdate)
  onTripUpdate(e: TripUpdateEvent) {
    this.server
      .to(['admin', `trip:${e.tripId}`])
      .emit(WsEvents.TripUpdate, { type: WsEvents.TripUpdate, ...e });
  }

  @OnEvent(InternalEvents.IncidentReported)
  onIncidentReported(e: IncidentReportedEvent) {
    this.server
      .to(['admin', `city:${e.cityCode}`])
      .emit(WsEvents.IncidentReported, {
        type: WsEvents.IncidentReported,
        ...e,
      });
  }

  @OnEvent(InternalEvents.WaitSessionAlert)
  onWaitSessionAlert(e: WaitSessionAlertEvent) {
    this.server
      .to([`wait:${e.waitSessionId}`, `user:${e.userId}`])
      .emit(WsEvents.WaitSessionAlert, {
        type: WsEvents.WaitSessionAlert,
        ...e,
      });
  }

  @OnEvent(InternalEvents.AgentAction)
  onAgentAction(e: AgentActionEvent) {
    // Only the admin view consumes agent actions
    this.server
      .to('admin')
      .emit(WsEvents.AgentAction, { type: WsEvents.AgentAction, ...e });
  }

  @OnEvent(InternalEvents.MetricsUpdate)
  onMetricsUpdate(e: MetricsUpdateEvent) {
    this.server
      .to('admin')
      .emit(WsEvents.MetricsUpdate, { type: WsEvents.MetricsUpdate, ...e });
  }

  // ============ Introspection (used by /realtime/health endpoint) ============

  getStats() {
    const adapter = this.server.sockets.adapter;
    const rooms = Array.from(adapter.rooms.entries())
      .filter(([name]) => !adapter.sids.has(name)) // filter out socket-id-named rooms
      .map(([name, set]) => ({ room: name, clients: set.size }))
      .sort((a, b) => b.clients - a.clients);

    return {
      totalConnections: this.server.engine.clientsCount,
      rooms,
    };
  }
}
