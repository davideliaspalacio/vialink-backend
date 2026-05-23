import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type {
  InternalEvents,
  RealtimeEventMap,
} from './realtime-events';

/**
 * Typed wrapper around EventEmitter2 so any service can emit realtime events
 * without coupling to Socket.io. The RealtimeGateway listens to these and
 * broadcasts to clients.
 *
 * Usage:
 *   this.eventBus.emit(InternalEvents.BusPosition, { busId, location, ... });
 */
@Injectable()
export class RealtimeEventBus {
  constructor(private readonly emitter: EventEmitter2) {}

  emit<K extends keyof RealtimeEventMap>(
    event: K,
    payload: RealtimeEventMap[K],
  ): void {
    this.emitter.emit(event, payload);
  }

  /**
   * Emit many events of the same type in a tight loop (e.g. BusEngine tick).
   * The underlying EventEmitter2 handles batching internally.
   */
  emitMany<K extends keyof RealtimeEventMap>(
    event: K,
    payloads: RealtimeEventMap[K][],
  ): void {
    for (const p of payloads) {
      this.emitter.emit(event, p);
    }
  }
}
