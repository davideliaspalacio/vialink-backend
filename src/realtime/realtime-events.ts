/**
 * Vialink — Internal event bus contract.
 *
 * Services emit these typed events via RealtimeEventBus; the gateway listens
 * and broadcasts to the appropriate Socket.io rooms.
 *
 * Naming convention (internal): `<entity>.<action_past>` (kebab on action,
 * dot separator). The wire-level WS event name is in `wsEvent` below.
 */

import type { LatLng } from '../common/types/geo';

// ---------- Bus ----------
export interface BusPositionEvent {
  busId: string;
  routeId: string;
  routeCode: string;
  cityCode: string;
  location: LatLng;
  heading: number | null;
  speedKmh: number;
  fractionOfCorridor: number;
  timestamp: string; // ISO
}

// ---------- Trip ----------
export type TripStatus = 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export interface TripUpdateEvent {
  tripId: string;
  userId: string;
  routeId: string;
  busId?: string;
  status: TripStatus;
  currentLocation?: LatLng;
  remainingSeconds?: number;
  timestamp: string;
}

// ---------- Incident ----------
export interface IncidentReportedEvent {
  incidentId: string;
  incidentType: 'TRAFFIC' | 'FULL_BUS' | 'NO_BUS_PASSING' | 'ACCIDENT';
  routeId: string | null;
  cityCode: string;
  location: LatLng;
  timestamp: string;
}

// ---------- Wait session ----------
export interface WaitSessionAlertEvent {
  waitSessionId: string;
  userId: string;
  busId: string;
  routeCode: string;
  etaSeconds: number;
  distanceM: number;
  timestamp: string;
}

// ---------- Agent action (simulator) ----------
export type AgentActionType =
  | 'walked'
  | 'started_waiting'
  | 'boarded'
  | 'asked_ai'
  | 'started_trip'
  | 'completed_trip'
  | 'rated_trip'
  | 'reported_incident'
  | 'saved_favorite';

export interface AgentActionEvent {
  agentId: string;
  agentName: string;
  agentProfile: string;
  action: AgentActionType;
  payload: Record<string, unknown>;
  location: LatLng | null;
  cityCode: string;
  timestamp: string;
}

// ---------- Metrics ----------
export interface MetricsUpdateEvent {
  cityCode: string;
  metrics: {
    activeUsers: number;
    activeTrips: number;
    aiQuestionsPerMinute: number;
    incidentsLastHour: number;
    busesInService: number;
  };
  timestamp: string;
}

// ---------- Map of internal name → WS wire event ----------
export const InternalEvents = {
  BusPosition: 'bus.position_updated',
  TripUpdate: 'trip.updated',
  IncidentReported: 'incident.reported',
  WaitSessionAlert: 'wait_session.alert',
  AgentAction: 'simulator.agent_action',
  MetricsUpdate: 'metrics.updated',
} as const;

export const WsEvents = {
  BusPosition: 'bus_position',
  TripUpdate: 'trip_update',
  IncidentReported: 'incident_reported',
  WaitSessionAlert: 'wait_session_alert',
  AgentAction: 'agent_action',
  MetricsUpdate: 'metrics_update',
} as const;

// Strongly-typed mapping for emit/subscribe
export type RealtimeEventMap = {
  [InternalEvents.BusPosition]: BusPositionEvent;
  [InternalEvents.TripUpdate]: TripUpdateEvent;
  [InternalEvents.IncidentReported]: IncidentReportedEvent;
  [InternalEvents.WaitSessionAlert]: WaitSessionAlertEvent;
  [InternalEvents.AgentAction]: AgentActionEvent;
  [InternalEvents.MetricsUpdate]: MetricsUpdateEvent;
};
