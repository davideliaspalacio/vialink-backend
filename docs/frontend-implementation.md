# Vialink Frontend — Implementation Guide (TDD)

> Técnico. Optimizado para que un agente IA (Cursor / Claude Code / Copilot) lo lea como contexto y pueda implementar pantalla por pantalla con tests primero.
>
> **Audiencia:** Sebastián (frontend lead) + su agente IA.
> **Estado backend:** desplegado en `https://vialink-backend-production.up.railway.app`. 29 endpoints REST + 6 eventos WebSocket. Simulador 500 agentes operativo.
> **Estado frontend:** infraestructura armada (api client, WS hook, dataSource pattern, 6 pantallas andamiadas, tipos definidos). Falta cablear contra backend real.
>
> Documento vivo. Si cambia el contrato del backend, este archivo se actualiza primero.

---

## Tabla de contenidos

- [0. Cómo usar este documento con tu agente IA](#0-cómo-usar-este-documento-con-tu-agente-ia)
- [1. Estado actual del frontend — lo que NO se reescribe](#1-estado-actual-del-frontend--lo-que-no-se-reescribe)
- [2. Setup TDD: Vitest + Testing Library + MSW](#2-setup-tdd-vitest--testing-library--msw)
- [3. Tipos backend-faithful + mappers](#3-tipos-backend-faithful--mappers)
- [4. dataSource completo (los 29 endpoints)](#4-datasource-completo-los-29-endpoints)
- [5. Hooks TanStack Query a crear](#5-hooks-tanstack-query-a-crear)
- [6. Implementación por pantalla (TDD)](#6-implementación-por-pantalla-tdd)
- [7. Realtime — wiring por pantalla](#7-realtime--wiring-por-pantalla)
- [8. Auth UI (Signup/Login)](#8-auth-ui-signuplogin)
- [9. MSW handlers (mocks completos)](#9-msw-handlers-mocks-completos)
- [10. Migración mocks → backend real](#10-migración-mocks--backend-real)
- [11. Smoke tests vs producción](#11-smoke-tests-vs-producción)
- [Apéndice A: Workflow recomendado con agente IA](#apéndice-a-workflow-recomendado-con-agente-ia)
- [Apéndice B: Mapping rápido pantalla → endpoints → WS rooms](#apéndice-b-mapping-rápido-pantalla--endpoints--ws-rooms)

---

## 0. Cómo usar este documento con tu agente IA

### Para humanos
Lee secuencial 0 → 3 (contexto + setup). Después salta a la sección de la pantalla que estás construyendo. Cada feature trae sus tests primero y luego la implementación.

### Para Cursor / Claude Code / agentes IA

**Paso 1 — Pega esto como system prompt o como primer mensaje al agente:**

```
Estás ayudando a implementar el frontend de Vialink, una webapp mobile-first de
transporte público para Barranquilla en hackathon de 48h.

Stack confirmado y NO negociable:
- React 19 + TypeScript + Vite
- Tailwind CSS (paleta brand ya definida en tailwind.config.js)
- React Router 7 (BrowserRouter)
- Zustand 5 (state local, NO redux)
- TanStack Query 5 (server state)
- socket.io-client 4 (realtime)
- Leaflet + react-leaflet (mapas, NO mapbox)
- Framer Motion 12 (animaciones, especialmente interpolación de buses)

Reglas inviolables:
1. NO reescribir `src/lib/api.ts`. Es production-grade y ya maneja auth+refresh+errores.
2. NO reescribir `src/hooks/useRealtime.ts`. Singleton socket con refcount y rooms tipadas.
3. NO reescribir `src/lib/dataSource.ts`. SOLO agregar branches faltantes.
4. Todo dato del backend pasa por un mapper centralizado en `src/lib/mappers.ts`
   antes de tocar componentes. Los componentes consumen los tipos del frontend
   (Paradero, Bus, etc.), no los del backend.
5. TDD obligatorio: para cada feature, escribir test rojo primero, luego código
   que lo pone verde, después refactor.
6. Mobile-first 393px. Cada componente debe verse bien en iPhone antes de cualquier
   otra cosa.
7. Coordenadas siempre {lat, lng}. NUNCA [lng, lat] excepto en GeoJSON.

Backend disponible en https://vialink-backend-production.up.railway.app
Swagger: https://vialink-backend-production.up.railway.app/api/docs
El backend ya tiene 86 buses moviéndose en tiempo real + simulador de 500 agentes.

Cuando te pida implementar algo, sigue este orden:
  1. Lee la sección correspondiente en frontend-implementation.md
  2. Escribe el o los tests primero
  3. Corre los tests (`pnpm test`) y confirma que fallan
  4. Implementa el código mínimo para que pasen
  5. Refactoriza si es necesario
  6. Verifica visualmente en `pnpm dev` con responsive de 393px

Si tienes que crear un archivo nuevo, usa exactamente el path que dice este doc.
Si tienes que modificar un archivo existente, primero léelo completo.
```

**Paso 2 — Comandos típicos para pedirle al agente:**

```
> "Implementa la pantalla Mapa principal siguiendo la sección 6.1 del doc."
> "Agrega el endpoint POST /buses-at-point al dataSource siguiendo la sección 4.3."
> "Cablea la vista admin con WebSocket real siguiendo la sección 7.5."
> "Escribe los tests del flujo de signup siguiendo la sección 8."
```

**Paso 3 — Cuando algo no funciona, dale contexto adicional:**

```
> "Aquí está el error que sale en la consola: [pega error]. El archivo que toqué
>  es src/dataSource.ts. Mira la sección 4 del doc y ayúdame a diagnosticar."
```

---

## 1. Estado actual del frontend — lo que NO se reescribe

Antes de implementar nada, el agente debe conocer lo que ya existe y respetar el estilo de la casa. Estos son los archivos clave del repo (`https://github.com/REN-ORDO/vialink-front`).

### 1.1 Stack instalado

```json
// package.json deps relevantes
{
  "@tanstack/react-query": "^5.100.11",
  "framer-motion": "^12.40.0",
  "leaflet": "^1.9.4",
  "react": "^19.2.6",
  "react-dom": "^19.2.6",
  "react-leaflet": "^5.0.0",
  "react-router-dom": "^7.15.1",
  "socket.io-client": "^4.8.3",
  "zustand": "^5.0.13",
  "tailwindcss": "^3.4.19",
  "typescript": "~6.0.2",
  "vite": "^8.0.12"
}
```

**Lo que falta para TDD** (sección 2):

```bash
pnpm add -D vitest @vitest/ui jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event msw@^2
```

### 1.2 `src/lib/api.ts` — HTTP client (NO TOCAR)

Resumen de lo que ya hace:
- Base URL desde `VITE_API_URL`, agrega `/api/v1` automáticamente
- Tokens en localStorage con keys `vl-access-token` y `vl-refresh-token`
- Helpers: `getAccessToken`, `getRefreshToken`, `setAuthTokens`, `clearAuthTokens`
- `api.get / post / patch / del` — agrega `Authorization: Bearer ...` cuando pasas `{ auth: true }`
- **Auto-refresh en 401**: si el token expiró, llama a `/auth/refresh`, reintenta una vez, si vuelve a fallar limpia tokens y tira `UnauthorizedError`
- Tipa los errores como `ApiError`, `UnauthorizedError`, `RateLimitError` (este último con `retryAfterMs`)

**Uso desde otros archivos**:
```ts
import { api, ApiError, UnauthorizedError, RateLimitError } from '../lib/api';

// Sin auth
const data = await api.get<MyType>('/landmarks/nearby');

// Con auth (manda Bearer automáticamente)
const me = await api.get<User>('/me', { auth: true });

// POST
const trip = await api.post<Trip>('/trips', { route_id, boarding_location }, { auth: true });

// Manejo de errores
try {
  await api.post('/assistant/ask', { question }, { auth: true });
} catch (err) {
  if (err instanceof RateLimitError) {
    showToast(`Espera ${err.retryAfterMs / 1000}s antes de preguntar de nuevo`);
  } else if (err instanceof UnauthorizedError) {
    navigate('/login');
  } else if (err instanceof ApiError) {
    showToast(err.message);
  }
}
```

### 1.3 `src/lib/dataSource.ts` — switch mocks/backend (EXTENDER, no reescribir)

Pattern: cada función tiene una rama `USE_MOCKS` y una rama "real". Si el backend falla, fallback automático a mocks. Esto permite trabajar offline y migrar gradualmente endpoint por endpoint.

**Reglas para agregar nuevos métodos:**
```ts
export const dataSource = {
  async newMethod(input: InputType): Promise<OutputType> {
    if (USE_MOCKS) {
      return mockImplementation(input);
    }
    try {
      const raw = await api.post<BackendRawType>('/endpoint', input);
      return mapBackendTo Frontend(raw);
    } catch (err) {
      if (err instanceof ApiError) return mockImplementation(input); // fallback
      throw err;
    }
  },
};
```

### 1.4 `src/hooks/useRealtime.ts` — Socket.io singleton (NO TOCAR)

Ya implementa:
- Singleton con refcount (varios componentes pueden suscribirse sin múltiples conexiones)
- Reconexión automática
- Subscribe/unsubscribe a rooms tipadas: `admin`, `city:${string}`, `trip:${string}`, `bus:${string}`, `wait:${string}`, `user:${string}`
- Auth con token JWT automático
- 7 eventos tipados: `bus_position`, `trip_update`, `incident_reported`, `wait_session_alert`, `metrics_update`, `agent_action`, `user_action`

**Uso desde un componente**:
```ts
import { useRealtime } from '../hooks/useRealtime';

function MapaPage() {
  const { status } = useRealtime({
    rooms: ['city:BAQ'],
    handlers: {
      bus_position: (event) => {
        // event ya está tipado como BusPosition
        updateBusOnMap(event.busId, event.location);
      },
      incident_reported: (event) => {
        addIncidentPin(event.location, event.incidentType);
      },
    },
  });
  // status puede ser 'idle' | 'connecting' | 'open' | 'closed' | 'error'
  ...
}
```

### 1.5 `src/store/useAppStore.ts` — Zustand (EXTENDER)

Estado global mínimo actual:
```ts
{
  userLat, userLng, setUserLocation,
  selectedParaderoId, setSelectedParaderoId,
}
```

Lo que vamos a agregar (sección 6 cubre el detalle):
```ts
{
  // ya está:
  userLat, userLng, setUserLocation,
  selectedParaderoId, setSelectedParaderoId,
  // a agregar:
  currentUser: User | null,
  setCurrentUser,
  activeTripId: string | null,
  setActiveTripId,
  activeWaitSessionId: string | null,
  setActiveWaitSessionId,
}
```

### 1.6 `src/types/index.ts` — tipos del producto (RESPETAR)

Los componentes consumen `Paradero`, `Ruta`, `Bus`, `Trip`, `Viaje`, etc. Mantenemos estos tipos intactos. **El backend devuelve otras shapes** (ver sección 3); los mappers traducen entre los dos mundos.

### 1.7 Estructura de archivos actual

```
src/
├── components/
│   ├── admin/        ActivityFeed, AgentMap, InsightRotator, MetricCard
│   ├── chat/         ChatInput, ChatMessage, RouteRecommendationCard, SuggestedActionCard
│   ├── map/          MapView, BusMarker, BusActiveMarker, ParaderoMarker, buses3d/Bus3DMarker
│   └── ui/           BottomSheet, RouteCard, SkeletonCard, TimeBadge
├── config/           operators.ts
├── hooks/            useInstallPrompt, useLocation, useParaderos, useRealtime,
│                     useSimulator (mock local), useViajeMock, useWebSocket
├── lib/              api.ts, dataSource.ts, format.ts, llmMock.ts, mockData.ts,
│                     routing.ts, lod/zoomToLOD.ts
├── pages/            MapaPage, ParaderoPage, AsistentePage, ViajePage,
│                     AdminPage, OnboardingPage
├── store/            useAppStore.ts
├── types/            index.ts
├── App.tsx           (BrowserRouter con 6 rutas)
└── main.tsx          (QueryClient + StrictMode)
```

**Archivos a CREAR** durante esta implementación:

```
src/
├── lib/
│   ├── mappers.ts          # backend ↔ frontend type conversion
│   └── mockHandlers.ts     # MSW handlers
├── types/
│   └── backend.ts          # tipos espejo del backend (raw)
├── hooks/
│   ├── useBusesAtPoint.ts
│   ├── useRoutes.ts
│   ├── useRouteCorridor.ts
│   ├── useRouteBuses.ts
│   ├── useLandmarkSearch.ts
│   ├── useAssistant.ts
│   ├── useActiveTrip.ts
│   ├── useWaitSession.ts
│   ├── useAdminMetrics.ts
│   ├── useAdminFeed.ts
│   └── useSimulatorControl.ts
├── components/
│   └── auth/
│       ├── SignupForm.tsx
│       └── LoginForm.tsx
└── test/
    ├── setup.ts            # vitest setup
    ├── server.ts           # MSW server
    └── utils.tsx           # test helpers (QueryClient wrapper, etc.)
```

---

## 2. Setup TDD: Vitest + Testing Library + MSW

### 2.1 Instalación

```bash
pnpm add -D vitest @vitest/ui jsdom \
  @testing-library/react @testing-library/jest-dom @testing-library/user-event \
  msw@^2.6 happy-dom
```

### 2.2 `vite.config.ts` actualizado

```ts
// vite.config.ts
/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
```

### 2.3 `src/test/setup.ts`

```ts
import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './server';

// Inicia el MSW server antes de los tests
beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// Polyfill localStorage si jsdom no lo trae
if (typeof window !== 'undefined' && !window.localStorage) {
  Object.defineProperty(window, 'localStorage', {
    value: {
      _store: {} as Record<string, string>,
      getItem(key: string) { return this._store[key] ?? null; },
      setItem(key: string, value: string) { this._store[key] = value; },
      removeItem(key: string) { delete this._store[key]; },
      clear() { this._store = {}; },
    },
  });
}
```

### 2.4 `src/test/server.ts` — MSW (vacío por ahora, lo llenamos en sección 9)

```ts
import { setupServer } from 'msw/node';
import { handlers } from '../lib/mockHandlers';

export const server = setupServer(...handlers);
```

### 2.5 `src/test/utils.tsx` — helpers para tests

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

interface ProvidersProps {
  children: ReactNode;
  initialRoute?: string;
}

function Providers({ children, initialRoute = '/' }: ProvidersProps) {
  const client = makeQueryClient();
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialRoute]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

export function renderWithProviders(
  ui: ReactElement,
  options: Omit<RenderOptions, 'wrapper'> & { initialRoute?: string } = {},
) {
  const { initialRoute, ...rest } = options;
  return render(ui, {
    wrapper: ({ children }) => (
      <Providers initialRoute={initialRoute}>{children}</Providers>
    ),
    ...rest,
  });
}

// Re-export para que los tests no importen de '@testing-library' directamente
export * from '@testing-library/react';
export { default as userEvent } from '@testing-library/user-event';
```

### 2.6 `package.json` scripts

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "lint": "eslint .",
    "preview": "vite preview",
    "test": "vitest",
    "test:ui": "vitest --ui",
    "test:run": "vitest run"
  }
}
```

### 2.7 Primer test — confirmación de setup

```ts
// src/test/setup.test.ts
import { describe, it, expect } from 'vitest';
import { renderWithProviders, screen } from './utils';

describe('test setup', () => {
  it('renders a basic component', () => {
    renderWithProviders(<div>hola Vialink</div>);
    expect(screen.getByText('hola Vialink')).toBeInTheDocument();
  });
});
```

Corre `pnpm test` — debe pasar en verde.

---

## 3. Tipos backend-faithful + mappers

Centralizamos toda la fricción de naming entre backend (snake_case, otras keys) y frontend (camelCase, tipos del producto) en dos archivos: `src/types/backend.ts` y `src/lib/mappers.ts`.

### 3.1 `src/types/backend.ts` — tipos espejo del backend

```ts
/**
 * Tipos EXACTOS de lo que el backend retorna.
 * NO importar estos tipos desde componentes. Solo desde mappers.ts.
 */

import type { LatLng } from './index';

// ===== Common =====
export type BackendLatLng = LatLng; // backend usa el mismo shape {lat, lng}

// ===== Landmarks =====
export type BackendLandmarkType =
  | 'UNIVERSITY' | 'MALL' | 'HOSPITAL' | 'SQUARE'
  | 'TRANSPORT_HUB' | 'NEIGHBORHOOD' | 'LANDMARK';

export interface BackendLandmark {
  id: string;
  name: string;
  type: BackendLandmarkType;
  address: string | null;
  location: LatLng;
}

export interface BackendLandmarkNearbyItem extends BackendLandmark {
  distance_m: number;
  routes_passing_count: number;
}

export interface BackendLandmarkNearbyResponse {
  landmarks: BackendLandmarkNearbyItem[];
}

export interface BackendLandmarkDetail extends BackendLandmark {
  routes: Array<{
    id: string;
    code: string;
    name: string;
    color: string;
    mode: BackendRouteMode;
    distance_to_corridor_m: number;
    status: 'OPERATING' | 'LOW_FREQUENCY' | 'OFFLINE';
  }>;
}

export interface BackendLandmarkSearchResponse {
  results: Array<{
    id: string;
    name: string;
    type: BackendLandmarkType;
    location: LatLng;
  }>;
}

// ===== Routes =====
export type BackendRouteMode = 'TRADITIONAL' | 'BRT' | 'METRO';

export interface BackendRoute {
  id: string;
  code: string;
  name: string;
  color: string;
  mode: BackendRouteMode;
  operator: string | null;
}

export interface BackendRouteListItem extends BackendRoute {
  landmarks_count: number;
  length_km: number | null;
}

export interface BackendRouteListResponse {
  routes: BackendRouteListItem[];
}

export interface BackendRouteDetail extends BackendRoute {
  length_km: number | null;
  landmarks: Array<{
    id: string;
    name: string;
    type: string;
    fraction_of_corridor: number;
    distance_to_corridor_m: number;
  }>;
  active_buses_count: number;
}

export interface BackendNearbyRouteItem {
  id: string;
  code: string;
  name: string;
  color: string;
  mode: BackendRouteMode;
  distance_m: number;
}

export interface BackendNearbyRoutesResponse {
  routes: BackendNearbyRouteItem[];
}

// GeoJSON LineString (orden estándar [lng, lat])
export interface BackendCorridorGeoJSON {
  type: 'Feature';
  geometry: {
    type: 'LineString';
    coordinates: [number, number][];
  };
  properties: {
    route_id: string;
    code: string;
    color: string;
  };
}

// ===== Buses =====
export interface BackendBus {
  id: string;
  plate: string;
  location: LatLng;
  heading: number | null;
  speed_kmh: number;
  fraction_of_corridor: number;
  last_seen_at: string;
}

export interface BackendRouteBusesResponse {
  buses: BackendBus[];
}

// ===== Buses at point (endpoint estrella) =====
export interface BackendNextBus {
  bus_id: string;
  plate: string;
  eta_seconds: number | null;
  distance_m: number;
  current_location: LatLng;
}

export interface BackendBusesAtPointRoute {
  route: BackendRoute;
  distance_to_corridor_m: number;
  next_buses: BackendNextBus[];
  status: 'OPERATING' | 'LOW_FREQUENCY' | 'OFFLINE';
}

export interface BackendBusesAtPointResponse {
  location: LatLng;
  routes: BackendBusesAtPointRoute[];
}

// ===== Auth =====
export interface BackendAuthSession {
  access_token: string;
  refresh_token: string;
  user: {
    id: string;
    email: string;
    name: string | null;
  };
}

export interface BackendMe {
  id: string;
  email: string;
  name: string | null;
  city_code: string;
  city_name: string;
  favorites_count: number;
  trips_count: number;
}

// ===== Favorites =====
export type BackendFavoriteTarget = 'LANDMARK' | 'ROUTE';

export interface BackendFavorite {
  id: string;
  target_type: BackendFavoriteTarget;
  alias: string | null;
  created_at: string;
  landmark: BackendLandmark | null;
  route: {
    id: string;
    code: string;
    name: string;
    color: string;
    mode: BackendRouteMode;
  } | null;
}

export interface BackendFavoritesResponse {
  favorites: BackendFavorite[];
}

// ===== Trips =====
export type BackendTripStatus = 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export interface BackendTrip {
  id: string;
  route: { id: string; code: string; color: string };
  bus: { id: string; plate: string } | null;
  boarding_location: LatLng;
  dropoff_location: LatLng;
  boarding_landmark_id: string | null;
  dropoff_landmark_id: string | null;
  started_at: string;
  ended_at: string | null;
  estimated_arrival_at: string | null;
  status: BackendTripStatus;
}

export interface BackendActiveTripResponse {
  trip: BackendTrip | null;
}

// ===== Wait sessions =====
export interface BackendWaitSession {
  id: string;
  location: LatLng;
  route: { id: string; code: string; color: string } | null;
  notify_seconds_before: number;
  status: 'WAITING' | 'ALERTED' | 'BOARDED' | 'CANCELLED' | 'EXPIRED';
  started_at: string;
}

// ===== Incidents =====
export type BackendIncidentType =
  | 'TRAFFIC' | 'FULL_BUS' | 'NO_BUS_PASSING' | 'ACCIDENT';

export interface BackendIncident {
  id: string;
  type: BackendIncidentType;
  route: { id: string; code: string | null } | null;
  location: LatLng;
  description: string | null;
  reported_at: string;
  reporter_name: string | null;
}

export interface BackendIncidentsNearbyResponse {
  incidents: BackendIncident[];
}

// ===== Assistant =====
export type BackendSuggestedAction =
  | { type: 'START_TRIP'; payload: {
      route_id: string; route_code: string;
      boarding_location: LatLng;
      dropoff_landmark_id?: string;
      dropoff_location?: LatLng;
      estimated_duration_seconds: number;
    } }
  | { type: 'SHOW_ROUTE'; payload: { route_id: string } }
  | { type: 'SHOW_LANDMARK'; payload: { landmark_id: string } }
  | { type: 'OPEN_WAIT_PIN'; payload: { location: LatLng; route_id?: string } };

export interface BackendAssistantAskResponse {
  answer: string;
  suggested_action: BackendSuggestedAction | null;
  latency_ms: number;
  tool_calls: Array<{
    name: string;
    input: Record<string, unknown>;
    ms: number;
  }>;
}

export interface BackendAssistantMessage {
  id: string;
  question: string;
  answer: string;
  suggested_action: BackendSuggestedAction | null;
  latency_ms: number | null;
  created_at: string;
}

export interface BackendAssistantMessagesResponse {
  messages: BackendAssistantMessage[];
}

// ===== Admin =====
export interface BackendAdminMetrics {
  metrics: {
    active_users: number;
    active_trips: number;
    ai_questions_per_minute: number;
    incidents_last_hour: number;
    buses_in_service: number;
    active_wait_sessions: number;
  };
  source: 'cached_2s' | 'fresh';
}

export type BackendFeedEventType =
  | 'trip_started' | 'trip_completed' | 'trip_cancelled'
  | 'incident_reported' | 'assistant_question'
  | 'rating_given' | 'favorite_saved' | 'agent_action';

export interface BackendFeedEvent {
  id: string;
  type: BackendFeedEventType;
  occurred_at: string;
  actor_name: string | null;
  payload: Record<string, unknown>;
}

export interface BackendAdminFeedResponse {
  events: BackendFeedEvent[];
}

export interface BackendSimulatorStatus {
  status: 'RUNNING' | 'STOPPED';
  agent_count: number;
  agents_by_profile: Record<string, number>;
  actions_last_minute: number;
  llm_calls_last_minute: number;
  ticks_processed: number;
  last_tick_ms: number | null;
  started_at: string | null;
}

// ===== WebSocket events (vienen del backend tal cual) =====
export interface BackendBusPositionEvent {
  type: 'bus_position';
  busId: string;
  routeId: string;
  routeCode: string;
  cityCode: string;
  location: LatLng;
  heading: number | null;
  speedKmh: number;
  fractionOfCorridor: number;
  timestamp: string;
}

export interface BackendTripUpdateEvent {
  type: 'trip_update';
  tripId: string;
  userId: string;
  routeId: string;
  busId?: string;
  status: BackendTripStatus;
  currentLocation?: LatLng;
  remainingSeconds?: number;
  timestamp: string;
}

export interface BackendIncidentReportedEvent {
  type: 'incident_reported';
  incidentId: string;
  incidentType: BackendIncidentType;
  routeId: string | null;
  cityCode: string;
  location: LatLng;
  timestamp: string;
}

export interface BackendWaitSessionAlertEvent {
  type: 'wait_session_alert';
  waitSessionId: string;
  userId: string;
  busId: string;
  routeCode: string;
  etaSeconds: number;
  distanceM: number;
  timestamp: string;
}

export interface BackendAgentActionEvent {
  type: 'agent_action';
  agentId: string;
  agentName: string;
  agentProfile: string;
  action: 'walked' | 'started_waiting' | 'boarded' | 'asked_ai'
    | 'started_trip' | 'completed_trip' | 'rated_trip'
    | 'reported_incident' | 'saved_favorite';
  payload: Record<string, unknown>;
  location: LatLng | null;
  cityCode: string;
  timestamp: string;
}

export interface BackendMetricsUpdateEvent {
  type: 'metrics_update';
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
```

### 3.2 `src/lib/mappers.ts`

Funciones puras que toman raw backend y devuelven tipos del frontend.

```ts
import type {
  Paradero, Ruta, RutaEstado, Bus, OperatorId,
  Trip, AssistantAskResponse, SuggestedAction,
  WaitSession, Incident, User, LatLng, ChatMessage,
} from '../types';
import type {
  BackendLandmark, BackendLandmarkDetail,
  BackendLandmarkNearbyItem, BackendBusesAtPointResponse,
  BackendBusesAtPointRoute, BackendRoute, BackendBus,
  BackendTrip, BackendAssistantAskResponse,
  BackendSuggestedAction, BackendWaitSession,
  BackendIncident, BackendMe, BackendAssistantMessage,
} from '../types/backend';

// ============================================================
// Routes
// ============================================================

/** Heurística para mapear código de ruta del backend a un operatorId del frontend. */
function operatorFromRoute(r: BackendRoute): OperatorId {
  if (r.mode === 'BRT' || r.code.startsWith('T')) return 'transmetro';
  if (r.operator?.toLowerCase().includes('puerto')) return 'bus_amarillo_pto';
  return 'bus_azul_pto';
}

function statusToFrontend(s: 'OPERATING' | 'LOW_FREQUENCY' | 'OFFLINE'): RutaEstado {
  if (s === 'LOW_FREQUENCY') return 'frecuencia_baja';
  if (s === 'OFFLINE') return 'ultimo_bus';
  return 'operando';
}

// ============================================================
// Paradero ← Landmark (+ opcional buses-at-point para ETAs)
// ============================================================

/**
 * Mapea Landmark detail + (opcional) buses-at-point a Paradero del frontend.
 * Si no se proporciona ETAs, todas las rutas quedan en 0 min con estado 'operando'.
 */
export function landmarkDetailToParadero(
  detail: BackendLandmarkDetail,
  busesAtPoint?: BackendBusesAtPointResponse,
): Paradero {
  const etasByRouteId = new Map<string, { etaMinutos: number; estado: RutaEstado }>();
  if (busesAtPoint) {
    for (const r of busesAtPoint.routes) {
      const firstBus = r.next_buses[0];
      etasByRouteId.set(r.route.id, {
        etaMinutos: firstBus?.eta_seconds != null
          ? Math.max(1, Math.round(firstBus.eta_seconds / 60))
          : 0,
        estado: statusToFrontend(r.status),
      });
    }
  }

  return {
    id: detail.id,
    nombre: detail.name,
    direccion: detail.address ?? '',
    lat: detail.location.lat,
    lng: detail.location.lng,
    rutas: detail.routes.map<Ruta>((r) => {
      const eta = etasByRouteId.get(r.id);
      return {
        id: r.id,
        nombre: r.code,
        destino: r.name,
        etaMinutos: eta?.etaMinutos ?? 0,
        estado: eta?.estado ?? statusToFrontend(r.status),
      };
    }),
  };
}

/** Versión ligera para listas (sin ETAs por ruta — quedan en 0). */
export function landmarkNearbyToParadero(item: BackendLandmarkNearbyItem): Paradero {
  return {
    id: item.id,
    nombre: item.name,
    direccion: item.address ?? '',
    lat: item.location.lat,
    lng: item.location.lng,
    rutas: [], // El detalle se carga al abrir el paradero
  };
}

// ============================================================
// Bus
// ============================================================

export function backendBusToBus(b: BackendBus, routeCode: string, route: BackendRoute): Bus {
  return {
    id: b.id,
    rutaNombre: routeCode,
    lat: b.location.lat,
    lng: b.location.lng,
    heading: b.heading ?? 0,
    operatorId: operatorFromRoute(route),
  };
}

/**
 * El endpoint POST /buses-at-point devuelve cada ruta con sus next_buses.
 * Esta función aplana a un array de Bus listo para el mapa.
 */
export function busesAtPointToBusList(resp: BackendBusesAtPointResponse): Bus[] {
  const out: Bus[] = [];
  for (const r of resp.routes) {
    for (const nb of r.next_buses) {
      out.push({
        id: nb.bus_id,
        rutaNombre: r.route.code,
        lat: nb.current_location.lat,
        lng: nb.current_location.lng,
        heading: 0, // El endpoint nearby no devuelve heading; el WS sí
        operatorId: operatorFromRoute(r.route),
      });
    }
  }
  return out;
}

// ============================================================
// Trip
// ============================================================

export function backendTripToTrip(t: BackendTrip): Trip {
  const startedAt = new Date(t.started_at).getTime();
  const eta = t.estimated_arrival_at ? new Date(t.estimated_arrival_at).getTime() : null;
  const remaining = eta != null
    ? Math.max(0, Math.round((eta - Date.now()) / 1000))
    : 0;
  return {
    id: t.id,
    routeId: t.route.id,
    routeCode: t.route.code,
    boardingLocation: t.boarding_location,
    dropoffLocation: t.dropoff_location,
    status: t.status,
    startedAt: t.started_at,
    completedAt: t.ended_at ?? undefined,
    remainingSeconds: remaining,
    currentLocation: undefined, // se actualiza vía WS trip_update
  };
}

// ============================================================
// Wait session
// ============================================================

export function backendWaitSessionToWaitSession(w: BackendWaitSession): WaitSession {
  return {
    id: w.id,
    location: w.location,
    routeId: w.route?.id,
    alertBeforeSeconds: w.notify_seconds_before,
    createdAt: w.started_at,
  };
}

// ============================================================
// Incident
// ============================================================

export function backendIncidentToIncident(i: BackendIncident): Incident {
  return {
    id: i.id,
    type: i.type,
    routeId: i.route?.id ?? null,
    location: i.location,
    reportedAt: i.reported_at,
    reportedBy: i.reporter_name ?? undefined,
  };
}

// ============================================================
// Assistant
// ============================================================

function backendActionToFrontendAction(a: BackendSuggestedAction | null): SuggestedAction | null {
  if (!a) return null;
  switch (a.type) {
    case 'START_TRIP':
      return {
        type: 'START_TRIP',
        routeId: a.payload.route_id,
        routeCode: a.payload.route_code,
      };
    case 'SHOW_ROUTE':
      return { type: 'SHOW_ROUTE', routeId: a.payload.route_id, routeCode: '' };
    case 'SHOW_LANDMARK':
      return { type: 'SHOW_LANDMARK', landmarkId: a.payload.landmark_id };
    case 'OPEN_WAIT_PIN':
      return {
        type: 'OPEN_WAIT_PIN',
        location: a.payload.location,
        routeId: a.payload.route_id,
      };
  }
}

export function backendAssistantAskToFrontend(
  r: BackendAssistantAskResponse,
): AssistantAskResponse {
  return {
    answer: r.answer,
    suggested_action: backendActionToFrontendAction(r.suggested_action),
  };
}

export function backendAssistantMessageToChatMessage(
  m: BackendAssistantMessage,
): { user: ChatMessage; assistant: ChatMessage } {
  return {
    user: {
      id: `${m.id}-q`,
      role: 'user',
      content: m.question,
      createdAt: m.created_at,
    },
    assistant: {
      id: `${m.id}-a`,
      role: 'assistant',
      content: m.answer,
      suggestedAction: backendActionToFrontendAction(m.suggested_action),
      createdAt: m.created_at,
    },
  };
}

// ============================================================
// User
// ============================================================

export function backendMeToUser(m: BackendMe): User {
  return {
    id: m.id,
    email: m.email,
    name: m.name ?? undefined,
    city: m.city_code,
    tripsCount: m.trips_count,
    favoritesCount: m.favorites_count,
  };
}
```

### 3.3 Tests de mappers (escribir primero)

```ts
// src/lib/mappers.test.ts
import { describe, it, expect } from 'vitest';
import {
  landmarkDetailToParadero,
  busesAtPointToBusList,
  backendTripToTrip,
  backendAssistantAskToFrontend,
} from './mappers';
import type {
  BackendLandmarkDetail,
  BackendBusesAtPointResponse,
  BackendTrip,
  BackendAssistantAskResponse,
} from '../types/backend';

describe('landmarkDetailToParadero', () => {
  const detail: BackendLandmarkDetail = {
    id: 'lm-1', name: 'Uninorte', type: 'UNIVERSITY',
    address: 'Km 5 Vía Pto Colombia',
    location: { lat: 11.0186, lng: -74.8499 },
    routes: [
      { id: 'r-1', code: 'C12', name: 'Centro-Uninorte', color: '#1E5EFF',
        mode: 'TRADITIONAL', distance_to_corridor_m: 30, status: 'OPERATING' },
    ],
  };

  it('mapea campos básicos', () => {
    const p = landmarkDetailToParadero(detail);
    expect(p.id).toBe('lm-1');
    expect(p.nombre).toBe('Uninorte');
    expect(p.lat).toBe(11.0186);
    expect(p.rutas).toHaveLength(1);
    expect(p.rutas[0].nombre).toBe('C12');
    expect(p.rutas[0].destino).toBe('Centro-Uninorte');
  });

  it('agrega ETAs cuando recibe buses-at-point', () => {
    const buses: BackendBusesAtPointResponse = {
      location: detail.location,
      routes: [{
        route: { id: 'r-1', code: 'C12', name: 'Centro-Uninorte',
          color: '#1E5EFF', mode: 'TRADITIONAL', operator: 'Coochofal' },
        distance_to_corridor_m: 30,
        next_buses: [{
          bus_id: 'b-1', plate: 'ABC123',
          eta_seconds: 180, distance_m: 800,
          current_location: { lat: 11.01, lng: -74.85 },
        }],
        status: 'OPERATING',
      }],
    };
    const p = landmarkDetailToParadero(detail, buses);
    expect(p.rutas[0].etaMinutos).toBe(3); // 180/60 = 3
    expect(p.rutas[0].estado).toBe('operando');
  });
});

describe('busesAtPointToBusList', () => {
  it('aplana las rutas a una lista de buses para el mapa', () => {
    const resp: BackendBusesAtPointResponse = {
      location: { lat: 11, lng: -74 },
      routes: [{
        route: { id: 'r-1', code: 'C12', name: '', color: '#1E5EFF',
          mode: 'TRADITIONAL', operator: null },
        distance_to_corridor_m: 0,
        next_buses: [
          { bus_id: 'b-1', plate: '', eta_seconds: 60, distance_m: 100,
            current_location: { lat: 11.01, lng: -74.01 } },
          { bus_id: 'b-2', plate: '', eta_seconds: 240, distance_m: 400,
            current_location: { lat: 11.02, lng: -74.02 } },
        ],
        status: 'OPERATING',
      }],
    };
    const buses = busesAtPointToBusList(resp);
    expect(buses).toHaveLength(2);
    expect(buses[0].rutaNombre).toBe('C12');
    expect(buses[0].lat).toBe(11.01);
  });
});

describe('backendAssistantAskToFrontend', () => {
  it('mapea suggested_action START_TRIP', () => {
    const r: BackendAssistantAskResponse = {
      answer: 'Toma la C12.',
      suggested_action: {
        type: 'START_TRIP',
        payload: {
          route_id: 'r-1', route_code: 'C12',
          boarding_location: { lat: 11, lng: -74 },
          estimated_duration_seconds: 1800,
        },
      },
      latency_ms: 1200,
      tool_calls: [],
    };
    const mapped = backendAssistantAskToFrontend(r);
    expect(mapped.answer).toBe('Toma la C12.');
    expect(mapped.suggested_action?.type).toBe('START_TRIP');
    if (mapped.suggested_action?.type === 'START_TRIP') {
      expect(mapped.suggested_action.routeId).toBe('r-1');
      expect(mapped.suggested_action.routeCode).toBe('C12');
    }
  });

  it('null suggested_action queda null', () => {
    const r: BackendAssistantAskResponse = {
      answer: 'No te entendí', suggested_action: null,
      latency_ms: 800, tool_calls: [],
    };
    expect(backendAssistantAskToFrontend(r).suggested_action).toBeNull();
  });
});

describe('backendTripToTrip', () => {
  it('calcula remainingSeconds desde estimated_arrival_at', () => {
    const future = new Date(Date.now() + 600_000).toISOString();
    const t: BackendTrip = {
      id: 't-1',
      route: { id: 'r-1', code: 'C12', color: '#1E5EFF' },
      bus: null,
      boarding_location: { lat: 11, lng: -74 },
      dropoff_location: { lat: 10.97, lng: -74.78 },
      boarding_landmark_id: null, dropoff_landmark_id: null,
      started_at: new Date().toISOString(),
      ended_at: null,
      estimated_arrival_at: future,
      status: 'IN_PROGRESS',
    };
    const trip = backendTripToTrip(t);
    expect(trip.routeCode).toBe('C12');
    expect(trip.remainingSeconds).toBeGreaterThan(550);
    expect(trip.remainingSeconds).toBeLessThanOrEqual(600);
  });
});
```

---

## 4. dataSource completo (los 29 endpoints)

Aquí están todas las branches reales del `dataSource.ts`. Mantén el switch `USE_MOCKS` + fallback en cada función. Cuando agregues una función, también agrega su test.

### 4.1 Plantilla TDD

Para cada endpoint nuevo:

```
1. Escribir test en src/lib/dataSource.test.ts (usa MSW handlers de sección 9)
2. Correr pnpm test — debe fallar
3. Implementar la función en src/lib/dataSource.ts
4. Correr pnpm test — debe pasar
5. Si el método se consume en componente, también crear hook (sección 5)
```

### 4.2 dataSource expandido — código completo

```ts
// src/lib/dataSource.ts (versión extendida)
import { api, ApiError, USE_MOCKS } from './api';
import { paraderosMock } from './mockData';
import { mockAskAssistant } from './llmMock';
import {
  landmarkDetailToParadero, landmarkNearbyToParadero,
  busesAtPointToBusList, backendBusToBus,
  backendTripToTrip, backendWaitSessionToWaitSession,
  backendIncidentToIncident, backendAssistantAskToFrontend,
  backendMeToUser, backendAssistantMessageToChatMessage,
} from './mappers';
import type {
  Paradero, Bus, Trip, WaitSession, Incident,
  AssistantAskResponse, LatLng, User, ChatMessage,
  AuthTokens, RouteRecommendation,
} from '../types';
import type {
  BackendLandmarkNearbyResponse, BackendLandmarkDetail,
  BackendLandmarkSearchResponse, BackendBusesAtPointResponse,
  BackendRouteListResponse, BackendRouteDetail,
  BackendCorridorGeoJSON, BackendRouteBusesResponse,
  BackendAuthSession, BackendMe, BackendFavoritesResponse,
  BackendActiveTripResponse, BackendTrip,
  BackendWaitSession, BackendIncidentsNearbyResponse,
  BackendAssistantAskResponse, BackendAssistantMessagesResponse,
  BackendAdminMetrics, BackendAdminFeedResponse,
  BackendSimulatorStatus, BackendNearbyRoutesResponse,
} from '../types/backend';

// ============================================================
// DISCOVERY
// ============================================================

export const dataSource = {
  useMocks: USE_MOCKS,

  // ---------- Landmarks ----------
  async getLandmarksNearby(location?: LatLng, radiusM = 1000): Promise<Paradero[]> {
    if (USE_MOCKS) return paraderosMock;
    const q = location
      ? `?lat=${location.lat}&lng=${location.lng}&radius_m=${radiusM}`
      : '?lat=11.0041&lng=-74.807&radius_m=1000';
    try {
      const raw = await api.get<BackendLandmarkNearbyResponse>(`/landmarks/nearby${q}`);
      return raw.landmarks.map(landmarkNearbyToParadero);
    } catch (err) {
      if (err instanceof ApiError) return paraderosMock;
      throw err;
    }
  },

  async getLandmark(id: string): Promise<Paradero> {
    if (USE_MOCKS) {
      const found = paraderosMock.find((p) => p.id === id);
      if (!found) throw new Error(`Paradero ${id} no encontrado`);
      return found;
    }
    const detail = await api.get<BackendLandmarkDetail>(`/landmarks/${id}`);
    // Opcionalmente carga ETAs en vivo para enriquecer:
    try {
      const buses = await api.post<BackendBusesAtPointResponse>('/buses-at-point', {
        location: detail.location,
        radius_m: 100,
      });
      return landmarkDetailToParadero(detail, buses);
    } catch {
      return landmarkDetailToParadero(detail);
    }
  },

  async searchLandmarks(query: string, limit = 10) {
    if (USE_MOCKS) {
      const q = query.toLowerCase();
      return paraderosMock
        .filter((p) => p.nombre.toLowerCase().includes(q))
        .slice(0, limit)
        .map((p) => ({
          id: p.id, name: p.nombre, type: 'LANDMARK' as const,
          location: { lat: p.lat, lng: p.lng },
        }));
    }
    const raw = await api.get<BackendLandmarkSearchResponse>(
      `/landmarks/search?q=${encodeURIComponent(query)}&limit=${limit}`,
    );
    return raw.results;
  },

  // ---------- buses-at-point (endpoint estrella) ----------
  async getBusesAtPoint(location: LatLng, radiusM = 100) {
    if (USE_MOCKS) {
      // Mock simple: devuelve rutas del primer paradero cercano
      return { routes: [], busesFlat: [] as Bus[] };
    }
    const raw = await api.post<BackendBusesAtPointResponse>('/buses-at-point', {
      location, radius_m: radiusM,
    });
    return {
      routes: raw.routes,                 // shape backend, útil para el bottom sheet
      busesFlat: busesAtPointToBusList(raw), // shape Bus para el mapa
    };
  },

  // ---------- Routes ----------
  async listRoutes(mode?: 'TRADITIONAL' | 'BRT' | 'METRO') {
    if (USE_MOCKS) return [];
    const q = mode ? `?mode=${mode}` : '';
    const raw = await api.get<BackendRouteListResponse>(`/routes${q}`);
    return raw.routes;
  },

  async getRoute(id: string) {
    if (USE_MOCKS) throw new Error('No disponible en mocks');
    return api.get<BackendRouteDetail>(`/routes/${id}`);
  },

  async getRouteCorridor(id: string): Promise<BackendCorridorGeoJSON> {
    if (USE_MOCKS) {
      return {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [] },
        properties: { route_id: id, code: '?', color: '#1E5EFF' },
      };
    }
    return api.get<BackendCorridorGeoJSON>(`/routes/${id}/corridor.geojson`);
  },

  async getRouteBuses(routeId: string): Promise<Bus[]> {
    if (USE_MOCKS) return [];
    const [route, raw] = await Promise.all([
      api.get<BackendRouteDetail>(`/routes/${routeId}`),
      api.get<BackendRouteBusesResponse>(`/routes/${routeId}/buses`),
    ]);
    return raw.buses.map((b) => backendBusToBus(b, route.code, route));
  },

  async getRoutesNearby(location: LatLng, radiusM = 100) {
    if (USE_MOCKS) return [];
    const raw = await api.get<BackendNearbyRoutesResponse>(
      `/routes/nearby?lat=${location.lat}&lng=${location.lng}&radius_m=${radiusM}`,
    );
    return raw.routes;
  },

  // ============================================================
  // AUTH
  // ============================================================

  async signup(input: { email: string; password: string; name?: string }) {
    if (USE_MOCKS) {
      const fakeUser: User = { id: 'mock-user', email: input.email, name: input.name };
      const tokens: AuthTokens = { access_token: 'mock-token', refresh_token: 'mock-refresh' };
      return { tokens, user: fakeUser };
    }
    const raw = await api.post<BackendAuthSession>('/auth/signup', input);
    return {
      tokens: { access_token: raw.access_token, refresh_token: raw.refresh_token },
      user: { id: raw.user.id, email: raw.user.email, name: raw.user.name ?? undefined },
    };
  },

  async login(input: { email: string; password: string }) {
    if (USE_MOCKS) {
      return {
        tokens: { access_token: 'mock-token', refresh_token: 'mock-refresh' },
        user: { id: 'mock-user', email: input.email },
      };
    }
    const raw = await api.post<BackendAuthSession>('/auth/login', input);
    return {
      tokens: { access_token: raw.access_token, refresh_token: raw.refresh_token },
      user: { id: raw.user.id, email: raw.user.email, name: raw.user.name ?? undefined },
    };
  },

  async getMe(): Promise<User> {
    if (USE_MOCKS) return { id: 'mock-user', email: 'mock@vialink.local' };
    const raw = await api.get<BackendMe>('/me', { auth: true });
    return backendMeToUser(raw);
  },

  // ---------- Favorites ----------
  async listFavorites() {
    if (USE_MOCKS) return [] as Array<{ id: string; alias?: string }>;
    const raw = await api.get<BackendFavoritesResponse>('/me/favorites', { auth: true });
    return raw.favorites;
  },

  async addFavorite(input: { target_type: 'LANDMARK' | 'ROUTE'; target_id: string; alias?: string }) {
    if (USE_MOCKS) return { id: 'mock-fav' };
    return api.post<{ id: string }>('/me/favorites', input, { auth: true });
  },

  async removeFavorite(id: string) {
    if (USE_MOCKS) return { deleted: true };
    return api.del<{ deleted: true }>(`/me/favorites/${id}`, { auth: true });
  },

  // ============================================================
  // TRIPS
  // ============================================================

  async getActiveTrip(): Promise<Trip | null> {
    if (USE_MOCKS) return null;
    const raw = await api.get<BackendActiveTripResponse>('/trips/active', { auth: true });
    return raw.trip ? backendTripToTrip(raw.trip) : null;
  },

  async startTrip(input: {
    route_id: string;
    boarding_location: LatLng;
    dropoff_location: LatLng;
    boarding_landmark_id?: string;
    dropoff_landmark_id?: string;
  }): Promise<Trip> {
    if (USE_MOCKS) throw new Error('No disponible en mocks');
    const raw = await api.post<BackendTrip>('/trips', input, { auth: true });
    return backendTripToTrip(raw);
  },

  async getTrip(id: string): Promise<Trip> {
    if (USE_MOCKS) throw new Error('No disponible en mocks');
    const raw = await api.get<BackendTrip>(`/trips/${id}`, { auth: true });
    return backendTripToTrip(raw);
  },

  async updateTripStatus(id: string, status: 'COMPLETED' | 'CANCELLED'): Promise<Trip> {
    if (USE_MOCKS) throw new Error('No disponible en mocks');
    const raw = await api.patch<BackendTrip>(`/trips/${id}`, { status }, { auth: true });
    return backendTripToTrip(raw);
  },

  async rateTrip(id: string, stars: number, comment?: string) {
    if (USE_MOCKS) return { id: 'mock-rating', stars };
    return api.post<{ id: string; stars: number; comment: string | null }>(
      `/trips/${id}/rating`, { stars, comment }, { auth: true },
    );
  },

  // ============================================================
  // WAIT SESSIONS
  // ============================================================

  async createWaitSession(input: {
    location: LatLng;
    route_id?: string;
    notify_seconds_before?: number;
  }): Promise<WaitSession> {
    if (USE_MOCKS) {
      return {
        id: `mock-wait-${Date.now()}`,
        location: input.location,
        routeId: input.route_id,
        alertBeforeSeconds: input.notify_seconds_before ?? 180,
        createdAt: new Date().toISOString(),
      };
    }
    const raw = await api.post<BackendWaitSession>('/wait-sessions', input, { auth: true });
    return backendWaitSessionToWaitSession(raw);
  },

  async cancelWaitSession(id: string) {
    if (USE_MOCKS) return { cancelled: true };
    return api.del<{ cancelled: true }>(`/wait-sessions/${id}`, { auth: true });
  },

  // ============================================================
  // INCIDENTS
  // ============================================================

  async reportIncident(input: {
    type: 'TRAFFIC' | 'FULL_BUS' | 'NO_BUS_PASSING' | 'ACCIDENT';
    location: LatLng;
    route_id?: string;
    description?: string;
  }) {
    if (USE_MOCKS) {
      return { id: `mock-inc-${Date.now()}`, type: input.type, location: input.location };
    }
    return api.post<{ id: string; type: string; location: LatLng }>(
      '/incidents', input, { auth: true },
    );
  },

  async listIncidentsNearby(location: LatLng, radiusM = 1500, sinceMin = 60): Promise<Incident[]> {
    if (USE_MOCKS) return [];
    const q = `?lat=${location.lat}&lng=${location.lng}&radius_m=${radiusM}&since_minutes=${sinceMin}`;
    const raw = await api.get<BackendIncidentsNearbyResponse>(`/incidents/nearby${q}`);
    return raw.incidents.map(backendIncidentToIncident);
  },

  // ============================================================
  // ASSISTANT
  // ============================================================

  async askAssistant(input: { question: string; location?: LatLng }): Promise<AssistantAskResponse & {
    recommendation?: RouteRecommendation;
  }> {
    if (USE_MOCKS) return mockAskAssistant(input.question);
    const raw = await api.post<BackendAssistantAskResponse>(
      '/assistant/ask', input, { auth: true },
    );
    return backendAssistantAskToFrontend(raw);
  },

  async listAssistantMessages(limit = 20): Promise<ChatMessage[]> {
    if (USE_MOCKS) return [];
    const raw = await api.get<BackendAssistantMessagesResponse>(
      `/assistant/messages?limit=${limit}`, { auth: true },
    );
    // Cada mensaje del backend tiene Q+A → dos ChatMessages
    const out: ChatMessage[] = [];
    for (const m of raw.messages) {
      const pair = backendAssistantMessageToChatMessage(m);
      out.push(pair.user, pair.assistant);
    }
    return out.reverse(); // backend ordena DESC, frontend espera ASC
  },

  // ============================================================
  // ADMIN
  // ============================================================

  async getAdminMetrics() {
    if (USE_MOCKS) {
      return {
        active_users: 437, active_trips: 89,
        ai_questions_per_minute: 23, incidents_last_hour: 4,
        buses_in_service: 142, active_wait_sessions: 12,
      };
    }
    const raw = await api.get<BackendAdminMetrics>('/admin/metrics');
    return raw.metrics;
  },

  async getAdminFeed(limit = 50, since?: string) {
    if (USE_MOCKS) return [];
    const q = `?limit=${limit}${since ? `&since=${encodeURIComponent(since)}` : ''}`;
    const raw = await api.get<BackendAdminFeedResponse>(`/admin/feed${q}`);
    return raw.events;
  },

  async startSimulator(agentCount = 100) {
    if (USE_MOCKS) {
      return {
        status: 'RUNNING' as const, agent_count: agentCount,
        agents_by_profile: {}, actions_last_minute: 0, llm_calls_last_minute: 0,
        ticks_processed: 0, last_tick_ms: null, started_at: new Date().toISOString(),
      };
    }
    return api.post<BackendSimulatorStatus>(
      '/admin/simulator/start', { agent_count: agentCount },
    );
  },

  async stopSimulator() {
    if (USE_MOCKS) return { status: 'STOPPED' as const };
    return api.post<BackendSimulatorStatus>('/admin/simulator/stop');
  },

  async resetSimulator() {
    if (USE_MOCKS) return { status: 'STOPPED' as const };
    return api.post<BackendSimulatorStatus>('/admin/simulator/reset');
  },

  async getSimulatorStatus(): Promise<BackendSimulatorStatus> {
    if (USE_MOCKS) {
      return {
        status: 'STOPPED', agent_count: 0, agents_by_profile: {},
        actions_last_minute: 0, llm_calls_last_minute: 0,
        ticks_processed: 0, last_tick_ms: null, started_at: null,
      };
    }
    return api.get<BackendSimulatorStatus>('/admin/simulator/status');
  },
};

export type DataSource = typeof dataSource;
```

---

## 5. Hooks TanStack Query a crear

Cada hook tiene un patrón fijo: query key + queryFn que llama a `dataSource` + opciones de staleTime razonables. **Escribe los tests primero** usando `renderHook` y MSW.

### 5.1 `src/hooks/useBusesAtPoint.ts`

```ts
import { useQuery } from '@tanstack/react-query';
import { dataSource } from '../lib/dataSource';
import type { LatLng } from '../types';

export function useBusesAtPoint(location: LatLng | null, radiusM = 100) {
  return useQuery({
    queryKey: ['buses-at-point', location?.lat, location?.lng, radiusM],
    queryFn: () => dataSource.getBusesAtPoint(location!, radiusM),
    enabled: !!location,
    staleTime: 3_000, // Backend cachea 3s; igual del lado del cliente
    refetchInterval: false, // se actualiza por WS bus_position
  });
}
```

**Test (`src/hooks/useBusesAtPoint.test.ts`):**
```ts
import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useBusesAtPoint } from './useBusesAtPoint';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeQueryClient } from '../test/utils';

function wrap(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('useBusesAtPoint', () => {
  it('no se ejecuta si location es null', () => {
    const c = makeQueryClient();
    const { result } = renderHook(() => useBusesAtPoint(null), { wrapper: wrap(c) });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('devuelve rutas y buses planos para Uninorte', async () => {
    const c = makeQueryClient();
    const { result } = renderHook(
      () => useBusesAtPoint({ lat: 11.0186, lng: -74.8499 }),
      { wrapper: wrap(c) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.routes.length).toBeGreaterThan(0);
  });
});
```

### 5.2 `src/hooks/useRoutes.ts`

```ts
import { useQuery } from '@tanstack/react-query';
import { dataSource } from '../lib/dataSource';

export function useRoutes(mode?: 'TRADITIONAL' | 'BRT' | 'METRO') {
  return useQuery({
    queryKey: ['routes', mode ?? 'all'],
    queryFn: () => dataSource.listRoutes(mode),
    staleTime: 5 * 60_000, // las rutas casi no cambian
  });
}
```

### 5.3 `src/hooks/useRouteCorridor.ts`

```ts
import { useQuery } from '@tanstack/react-query';
import { dataSource } from '../lib/dataSource';

export function useRouteCorridor(routeId: string | undefined) {
  return useQuery({
    queryKey: ['route-corridor', routeId],
    queryFn: () => dataSource.getRouteCorridor(routeId!),
    enabled: !!routeId,
    staleTime: 60 * 60_000, // un corridor no cambia salvo redeploy
  });
}
```

### 5.4 `src/hooks/useRouteBuses.ts`

```ts
import { useQuery } from '@tanstack/react-query';
import { dataSource } from '../lib/dataSource';

export function useRouteBuses(routeId: string | undefined) {
  return useQuery({
    queryKey: ['route-buses', routeId],
    queryFn: () => dataSource.getRouteBuses(routeId!),
    enabled: !!routeId,
    staleTime: 5_000,
    refetchInterval: false, // posiciones se actualizan por WS bus_position
  });
}
```

### 5.5 `src/hooks/useLandmarkSearch.ts`

```ts
import { useQuery } from '@tanstack/react-query';
import { dataSource } from '../lib/dataSource';

export function useLandmarkSearch(query: string) {
  const debounced = query.trim();
  return useQuery({
    queryKey: ['landmark-search', debounced],
    queryFn: () => dataSource.searchLandmarks(debounced),
    enabled: debounced.length >= 2,
    staleTime: 30_000,
  });
}
```

### 5.6 `src/hooks/useAssistant.ts`

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dataSource } from '../lib/dataSource';
import type { LatLng } from '../types';

export function useAssistantHistory() {
  return useQuery({
    queryKey: ['assistant-history'],
    queryFn: () => dataSource.listAssistantMessages(20),
    staleTime: 30_000,
  });
}

export function useAskAssistant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { question: string; location?: LatLng }) =>
      dataSource.askAssistant(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assistant-history'] });
    },
  });
}
```

### 5.7 `src/hooks/useActiveTrip.ts`

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dataSource } from '../lib/dataSource';
import type { LatLng } from '../types';

export function useActiveTrip() {
  return useQuery({
    queryKey: ['trip-active'],
    queryFn: () => dataSource.getActiveTrip(),
    staleTime: 10_000,
  });
}

export function useStartTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      route_id: string;
      boarding_location: LatLng;
      dropoff_location: LatLng;
      boarding_landmark_id?: string;
      dropoff_landmark_id?: string;
    }) => dataSource.startTrip(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trip-active'] }),
  });
}

export function useCompleteTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tripId: string) => dataSource.updateTripStatus(tripId, 'COMPLETED'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trip-active'] }),
  });
}

export function useCancelTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tripId: string) => dataSource.updateTripStatus(tripId, 'CANCELLED'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trip-active'] }),
  });
}

export function useRateTrip() {
  return useMutation({
    mutationFn: (input: { tripId: string; stars: number; comment?: string }) =>
      dataSource.rateTrip(input.tripId, input.stars, input.comment),
  });
}
```

### 5.8 `src/hooks/useWaitSession.ts`

```ts
import { useMutation } from '@tanstack/react-query';
import { dataSource } from '../lib/dataSource';
import type { LatLng } from '../types';

export function useCreateWaitSession() {
  return useMutation({
    mutationFn: (input: {
      location: LatLng;
      route_id?: string;
      notify_seconds_before?: number;
    }) => dataSource.createWaitSession(input),
  });
}

export function useCancelWaitSession() {
  return useMutation({
    mutationFn: (id: string) => dataSource.cancelWaitSession(id),
  });
}
```

### 5.9 `src/hooks/useAdminMetrics.ts` y `useAdminFeed.ts`

```ts
// useAdminMetrics.ts
import { useQuery } from '@tanstack/react-query';
import { dataSource } from '../lib/dataSource';

export function useAdminMetrics() {
  return useQuery({
    queryKey: ['admin-metrics'],
    queryFn: () => dataSource.getAdminMetrics(),
    refetchInterval: 5_000, // backup si el WS metrics_update no llega
    staleTime: 2_000,
  });
}

// useAdminFeed.ts
import { useQuery } from '@tanstack/react-query';
import { dataSource } from '../lib/dataSource';

export function useAdminFeed(limit = 50) {
  return useQuery({
    queryKey: ['admin-feed', limit],
    queryFn: () => dataSource.getAdminFeed(limit),
    refetchInterval: 10_000, // backup si WS agent_action no llega
  });
}
```

### 5.10 `src/hooks/useSimulatorControl.ts`

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dataSource } from '../lib/dataSource';

export function useSimulatorStatus() {
  return useQuery({
    queryKey: ['simulator-status'],
    queryFn: () => dataSource.getSimulatorStatus(),
    refetchInterval: 5_000,
  });
}

export function useStartSimulator() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentCount: number) => dataSource.startSimulator(agentCount),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['simulator-status'] }),
  });
}

export function useStopSimulator() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => dataSource.stopSimulator(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['simulator-status'] }),
  });
}

export function useResetSimulator() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => dataSource.resetSimulator(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['simulator-status'] }),
  });
}
```

---

## 6. Implementación por pantalla (TDD)

Para cada pantalla: **user story → tests → implementación**.

### 6.1 Pantalla Mapa principal (`MapaPage.tsx`)

#### User stories
- Como usuario, al abrir la app veo el mapa de Barranquilla centrado en mi ubicación (si la doy) o en el centro de la ciudad.
- Veo los **lugares populares** (paraderos) cerca como anclajes visuales.
- Veo los **buses moviéndose en tiempo real** sobre el mapa (interpolados, no brincando).
- Cuando hago tap en cualquier punto del mapa, se abre un bottom sheet con las rutas que pasan + próximos buses + ETAs.
- Si toco un paradero (anclaje), navego a `/paradero/:id`.

#### Tests primero

```ts
// src/pages/MapaPage.test.tsx
import { describe, it, expect } from 'vitest';
import { renderWithProviders, screen, waitFor } from '../test/utils';
import MapaPage from './MapaPage';

describe('MapaPage', () => {
  it('renderiza el contenedor del mapa', () => {
    renderWithProviders(<MapaPage />);
    expect(screen.getByTestId('map-container')).toBeInTheDocument();
  });

  it('muestra los paraderos cercanos del mock cuando carga', async () => {
    renderWithProviders(<MapaPage />);
    await waitFor(() => {
      expect(screen.getAllByTestId('paradero-marker').length).toBeGreaterThan(0);
    });
  });

  it('al tocar el mapa, abre el bottom sheet con buses-at-point', async () => {
    const { container } = renderWithProviders(<MapaPage />);
    // Simulamos el click handler del mapa (se testea más fácil desde el handler que del Leaflet real)
    // Ver implementación abajo: exponemos `onMapClick` en MapView
    // Tests más completos van con react-leaflet event simulation o mocks de MapView
  });
});
```

#### Implementación (incremental)

1. Crear `MapView` (si no existe completamente) con prop `onMapClick(latlng)`.
2. En `MapaPage`:

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import MapView from '../components/map/MapView';
import BottomSheet from '../components/ui/BottomSheet';
import { useAppStore } from '../store/useAppStore';
import { useParaderos } from '../hooks/useParaderos';
import { useBusesAtPoint } from '../hooks/useBusesAtPoint';
import { useRealtime } from '../hooks/useRealtime';
import type { LatLng, Bus } from '../types';

export default function MapaPage() {
  const navigate = useNavigate();
  const userLocation = useAppStore((s) =>
    s.userLat != null && s.userLng != null ? { lat: s.userLat, lng: s.userLng } : null,
  );
  const [tapped, setTapped] = useState<LatLng | null>(null);
  const [liveBuses, setLiveBuses] = useState<Record<string, Bus>>({});

  const { data: paraderos } = useParaderos();
  const { data: busesAtPoint } = useBusesAtPoint(tapped, 100);

  // Suscripción a buses en vivo
  useRealtime({
    rooms: ['city:BAQ'],
    handlers: {
      bus_position: (event) => {
        setLiveBuses((prev) => ({
          ...prev,
          [event.busId]: {
            id: event.busId,
            rutaNombre: event.routeCode,
            lat: event.location.lat,
            lng: event.location.lng,
            heading: event.heading ?? 0,
            operatorId: 'bus_azul_pto',
          },
        }));
      },
    },
  });

  const buses = Object.values(liveBuses);

  return (
    <div className="w-full h-screen relative">
      <MapView
        data-testid="map-container"
        center={userLocation ?? { lat: 11.004, lng: -74.807 }}
        paraderos={paraderos ?? []}
        buses={buses}
        onMapClick={setTapped}
        onParaderoClick={(id) => navigate(`/paradero/${id}`)}
      />
      {tapped && (
        <BottomSheet onClose={() => setTapped(null)}>
          {busesAtPoint?.routes.map((r) => (
            <div key={r.route.id} className="p-3 border-b">
              <div className="font-bold" style={{ color: r.route.color }}>{r.route.code}</div>
              <div className="text-sm text-text-secondary">{r.route.name}</div>
              {r.next_buses[0]?.eta_seconds != null ? (
                <div className="text-brand">
                  Próximo bus en {Math.round(r.next_buses[0].eta_seconds / 60)} min
                </div>
              ) : (
                <div className="text-text-secondary">Sin buses cerca</div>
              )}
            </div>
          ))}
        </BottomSheet>
      )}
    </div>
  );
}
```

#### Animación suave de buses (CRÍTICO)

En `BusMarker.tsx` interpola entre la posición previa y la nueva con `framer-motion`:

```tsx
// src/components/map/BusMarker.tsx
import { useEffect, useState } from 'react';
import { Marker } from 'react-leaflet';
import L from 'leaflet';
import { motion, useMotionValue, animate } from 'framer-motion';
import type { Bus } from '../../types';

interface Props {
  bus: Bus;
}

export default function BusMarker({ bus }: Props) {
  const [pos, setPos] = useState<[number, number]>([bus.lat, bus.lng]);

  useEffect(() => {
    // Anima a la nueva posición durante 1000 ms (matching el tick del backend)
    const start = pos;
    const end: [number, number] = [bus.lat, bus.lng];
    const ms = 1000;
    const startTime = performance.now();
    let raf = 0;

    function step(t: number) {
      const elapsed = (t - startTime) / ms;
      const p = Math.min(1, elapsed);
      const lat = start[0] + (end[0] - start[0]) * p;
      const lng = start[1] + (end[1] - start[1]) * p;
      setPos([lat, lng]);
      if (p < 1) raf = requestAnimationFrame(step);
    }
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [bus.lat, bus.lng]);

  const icon = L.divIcon({
    className: 'bus-marker',
    html: `<div class="px-2 py-1 rounded-full bg-brand text-white text-xs font-bold shadow">${bus.rutaNombre}</div>`,
  });

  return <Marker position={pos} icon={icon} />;
}
```

### 6.2 Pantalla Detalle de Paradero (`ParaderoPage.tsx`)

#### User story
- Como usuario, al tocar un paradero veo su nombre, dirección, y la lista de rutas con sus ETAs en vivo.
- Cada ruta es tappable y me muestra el corridor en el mapa de fondo.

#### Tests

```ts
// src/pages/ParaderoPage.test.tsx
import { describe, it, expect } from 'vitest';
import { renderWithProviders, screen, waitFor } from '../test/utils';
import ParaderoPage from './ParaderoPage';

describe('ParaderoPage', () => {
  it('muestra el nombre del paradero y sus rutas', async () => {
    renderWithProviders(<ParaderoPage />, { initialRoute: '/paradero/lm-uninorte' });
    await waitFor(() => {
      expect(screen.getByText(/uninorte/i)).toBeInTheDocument();
    });
  });

  it('muestra al menos una ruta con su ETA', async () => {
    renderWithProviders(<ParaderoPage />, { initialRoute: '/paradero/lm-uninorte' });
    await waitFor(() => {
      expect(screen.getAllByTestId('route-card').length).toBeGreaterThan(0);
    });
  });
});
```

#### Implementación

```tsx
// src/pages/ParaderoPage.tsx
import { useParams } from 'react-router-dom';
import { useParadero } from '../hooks/useParaderos';
import { useBusesAtPoint } from '../hooks/useBusesAtPoint';
import RouteCard from '../components/ui/RouteCard';
import SkeletonCard from '../components/ui/SkeletonCard';

export default function ParaderoPage() {
  const { id } = useParams<{ id: string }>();
  const { data: paradero, isLoading } = useParadero(id);
  // Si quieres ETAs en vivo (no las del fetch inicial):
  const { data: live } = useBusesAtPoint(
    paradero ? { lat: paradero.lat, lng: paradero.lng } : null,
    100,
  );

  if (isLoading || !paradero) {
    return <div className="p-4"><SkeletonCard /></div>;
  }

  // Combina rutas del paradero con ETAs en vivo si están
  const liveEtaByCode = new Map(
    (live?.routes ?? []).map((r) => [r.route.code, r.next_buses[0]?.eta_seconds ?? null]),
  );

  return (
    <main className="p-4 max-w-[393px] mx-auto">
      <h1 className="text-2xl font-bold">{paradero.nombre}</h1>
      <p className="text-text-secondary">{paradero.direccion}</p>
      <div className="mt-6 space-y-3">
        {paradero.rutas.map((r) => {
          const liveEtaSec = liveEtaByCode.get(r.nombre) ?? null;
          const eta = liveEtaSec != null
            ? Math.max(1, Math.round(liveEtaSec / 60))
            : r.etaMinutos;
          return (
            <RouteCard
              key={r.id}
              data-testid="route-card"
              ruta={{ ...r, etaMinutos: eta }}
            />
          );
        })}
      </div>
    </main>
  );
}
```

### 6.3 Pantalla Asistente IA (`AsistentePage.tsx`)

#### User story
- Como usuario veo un chat scroll, input fijo abajo, sugerencias de preguntas en chips arriba si no he preguntado nada.
- Al enviar, aparece mi mensaje y un loading skeleton hasta que llega la respuesta.
- Si la respuesta trae `suggested_action`, la renderizo como card tappable (botón "Iniciar viaje", "Ver ruta", etc).
- Si el backend devuelve 429, muestro toast "Espera unos segundos" y deshabilito el botón.

#### Tests clave

```ts
// src/pages/AsistentePage.test.tsx
import { describe, it, expect } from 'vitest';
import { renderWithProviders, screen, userEvent, waitFor } from '../test/utils';
import AsistentePage from './AsistentePage';

describe('AsistentePage', () => {
  it('envía pregunta y muestra respuesta del mock', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AsistentePage />);
    const input = screen.getByPlaceholderText(/pregunta/i);
    await user.type(input, '¿Cómo llego al Centro?');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByTestId('chat-message-assistant')).toBeInTheDocument();
    });
  });

  it('renderiza suggested_action como botón tappable', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AsistentePage />);
    const input = screen.getByPlaceholderText(/pregunta/i);
    await user.type(input, 'Voy de afán al Centro');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /iniciar viaje|ver ruta|ver lugar|esperar bus/i })).toBeInTheDocument();
    });
  });
});
```

#### Implementación

```tsx
// src/pages/AsistentePage.tsx
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import { useAskAssistant, useAssistantHistory } from '../hooks/useAssistant';
import ChatInput from '../components/chat/ChatInput';
import ChatMessage from '../components/chat/ChatMessage';
import SuggestedActionCard from '../components/chat/SuggestedActionCard';
import type { ChatMessage as ChatMessageType, SuggestedAction } from '../types';
import { RateLimitError } from '../lib/api';

const SUGGESTED_PROMPTS = [
  '¿Cómo llego al Centro si voy de afán?',
  '¿Qué bus me lleva a Uninorte?',
  '¿Cuándo viene el próximo bus aquí?',
];

export default function AsistentePage() {
  const navigate = useNavigate();
  const userLat = useAppStore((s) => s.userLat);
  const userLng = useAppStore((s) => s.userLng);
  const location = userLat != null && userLng != null ? { lat: userLat, lng: userLng } : undefined;

  const { data: history } = useAssistantHistory();
  const ask = useAskAssistant();
  const [localMessages, setLocalMessages] = useState<ChatMessageType[]>([]);
  const [rateLimitedUntil, setRateLimitedUntil] = useState<number>(0);
  const endRef = useRef<HTMLDivElement>(null);

  const messages = [...(history ?? []), ...localMessages];
  const isRateLimited = Date.now() < rateLimitedUntil;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  async function handleSend(question: string) {
    if (!question.trim() || isRateLimited) return;
    const userMsg: ChatMessageType = {
      id: `local-${Date.now()}`,
      role: 'user',
      content: question,
      createdAt: new Date().toISOString(),
    };
    setLocalMessages((prev) => [...prev, userMsg]);
    try {
      const resp = await ask.mutateAsync({ question, location });
      const assistantMsg: ChatMessageType = {
        id: `local-${Date.now() + 1}`,
        role: 'assistant',
        content: resp.answer,
        suggestedAction: resp.suggested_action,
        createdAt: new Date().toISOString(),
      };
      setLocalMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      if (err instanceof RateLimitError) {
        setRateLimitedUntil(Date.now() + err.retryAfterMs);
      }
      const errMsg: ChatMessageType = {
        id: `local-${Date.now() + 1}`,
        role: 'assistant',
        content: 'No pude responderte en este momento. Intenta de nuevo en unos segundos.',
        createdAt: new Date().toISOString(),
      };
      setLocalMessages((prev) => [...prev, errMsg]);
    }
  }

  function handleAction(a: SuggestedAction) {
    switch (a.type) {
      case 'START_TRIP':
        navigate(`/viaje/${a.routeId}`);
        break;
      case 'SHOW_LANDMARK':
        navigate(`/paradero/${a.landmarkId}`);
        break;
      case 'SHOW_ROUTE':
        // navega o muestra modal según UX deseada
        break;
      case 'OPEN_WAIT_PIN':
        // dispara modal de pin de espera
        break;
    }
  }

  return (
    <div className="flex flex-col h-screen max-w-[393px] mx-auto">
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="space-y-2">
            <p className="text-sm text-text-secondary">Pregúntame algo:</p>
            {SUGGESTED_PROMPTS.map((p) => (
              <button
                key={p}
                onClick={() => handleSend(p)}
                className="block w-full text-left px-4 py-3 rounded-card bg-surface-raised"
              >
                {p}
              </button>
            ))}
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} data-testid={`chat-message-${m.role}`}>
            <ChatMessage message={m} />
            {m.suggestedAction && (
              <SuggestedActionCard action={m.suggestedAction} onAction={handleAction} />
            )}
          </div>
        ))}
        {ask.isPending && <div className="text-text-secondary">…escribiendo</div>}
        <div ref={endRef} />
      </div>
      <ChatInput
        onSend={handleSend}
        disabled={ask.isPending || isRateLimited}
        placeholder={isRateLimited ? 'Espera unos segundos…' : 'Pregunta lo que sea'}
      />
    </div>
  );
}
```

### 6.4 Pantalla Viaje activo (`ViajePage.tsx`)

#### User story
- Como usuario veo el mapa con el recorrido de mi ruta dibujado y el bus moviéndose en tiempo real.
- Hero arriba con tiempo restante grande.
- Botones "Completar" y "Cancelar".
- Al completar, navego a rating.

#### Tests + implementación (resumen)

```tsx
// src/pages/ViajePage.tsx
import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useActiveTrip, useCompleteTrip, useCancelTrip } from '../hooks/useActiveTrip';
import { useRouteCorridor } from '../hooks/useRouteCorridor';
import { useRealtime } from '../hooks/useRealtime';
import MapView from '../components/map/MapView';

export default function ViajePage() {
  const navigate = useNavigate();
  const { id: tripId } = useParams<{ id: string }>();
  const { data: trip } = useActiveTrip();
  const corridor = useRouteCorridor(trip?.routeId);
  const complete = useCompleteTrip();
  const cancel = useCancelTrip();

  // Suscríbete al room trip:<id> para trip_update + bus_position
  useRealtime({
    rooms: tripId ? [`trip:${tripId}`] : [],
    enabled: !!tripId,
    handlers: {
      trip_update: (event) => {
        if (event.status === 'COMPLETED') navigate(`/viaje/${tripId}/calificar`);
      },
    },
  });

  if (!trip) return <div className="p-4">Sin viaje activo</div>;

  return (
    <div className="flex flex-col h-screen max-w-[393px] mx-auto">
      <div className="bg-brand text-white p-6 text-center">
        <div className="text-sm uppercase opacity-80">Tiempo restante</div>
        <div className="text-5xl font-bold">{Math.round(trip.remainingSeconds / 60)} min</div>
        <div className="text-sm mt-1">Ruta {trip.routeCode}</div>
      </div>
      <div className="flex-1 relative">
        <MapView
          center={trip.boardingLocation}
          paraderos={[]}
          buses={[]}
          corridorGeoJson={corridor.data ?? null}
        />
      </div>
      <div className="p-4 flex gap-3">
        <button
          onClick={() => trip && complete.mutate(trip.id)}
          className="flex-1 bg-success text-white py-3 rounded-card-lg font-bold"
        >Completar</button>
        <button
          onClick={() => trip && cancel.mutate(trip.id)}
          className="flex-1 bg-danger text-white py-3 rounded-card-lg font-bold"
        >Cancelar</button>
      </div>
    </div>
  );
}
```

### 6.5 Pantalla Admin (la del pitch) — `AdminPage.tsx`

#### User story
- Mapa de Barranquilla pantalla completa con 500 puntos animados (agentes + buses).
- Cards de métricas grandes que cambian cada 2s.
- Feed lateral con scroll automático de acciones recientes.
- Botón "Iniciar simulador" / "Detener" / "Reset".

#### Implementación cableando con backend real

```tsx
// src/pages/AdminPage.tsx
import { useEffect, useState } from 'react';
import { useAdminMetrics } from '../hooks/useAdminMetrics';
import { useAdminFeed } from '../hooks/useAdminFeed';
import {
  useSimulatorStatus, useStartSimulator,
  useStopSimulator, useResetSimulator,
} from '../hooks/useSimulatorControl';
import { useRealtime } from '../hooks/useRealtime';
import ActivityFeed from '../components/admin/ActivityFeed';
import AgentMap from '../components/admin/AgentMap';
import MetricCard from '../components/admin/MetricCard';
import InsightRotator from '../components/admin/InsightRotator';
import type { AdminMetrics, AgentEvent, BusPosition } from '../types';

export default function AdminPage() {
  const { data: metricsSnapshot } = useAdminMetrics();
  const { data: feedSnapshot } = useAdminFeed(50);
  const { data: simStatus } = useSimulatorStatus();
  const startSim = useStartSimulator();
  const stopSim = useStopSimulator();
  const resetSim = useResetSimulator();

  // Estado en vivo del WS
  const [liveMetrics, setLiveMetrics] = useState<AdminMetrics | null>(null);
  const [liveFeed, setLiveFeed] = useState<AgentEvent[]>([]);
  const [liveBuses, setLiveBuses] = useState<Record<string, BusPosition>>({});

  useRealtime({
    rooms: ['admin'],
    handlers: {
      metrics_update: (event) => setLiveMetrics(event.metrics),
      agent_action: (event) => {
        setLiveFeed((prev) =>
          [{
            type: 'agent_action' as const,
            userId: event.agentId,
            userName: event.agentName,
            agentProfile: event.agentProfile,
            action: event.action,
            payload: event.payload,
            location: event.location ?? { lat: 0, lng: 0 },
            timestamp: event.timestamp,
          }, ...prev].slice(0, 60),
        );
      },
      bus_position: (event) => {
        setLiveBuses((prev) => ({ ...prev, [event.busId]: event }));
      },
    },
  });

  const metrics = liveMetrics ?? metricsSnapshot;

  return (
    <div className="flex h-screen bg-text-primary text-white">
      <div className="flex-1 relative">
        <AgentMap buses={Object.values(liveBuses)} feed={liveFeed} />
      </div>
      <aside className="w-80 p-6 overflow-y-auto space-y-4 border-l border-white/10">
        <div className="grid grid-cols-2 gap-3">
          {metrics && (
            <>
              <MetricCard label="Usuarios activos" value={metrics.active_users} />
              <MetricCard label="Viajes en curso" value={metrics.active_trips} />
              <MetricCard label="IA / min" value={metrics.ai_questions_per_minute} />
              <MetricCard label="Buses en servicio" value={metrics.buses_in_service} />
            </>
          )}
        </div>
        <InsightRotator />
        <div className="flex gap-2">
          <button
            onClick={() => startSim.mutate(500)}
            disabled={simStatus?.status === 'RUNNING'}
            className="px-3 py-2 bg-brand rounded text-sm disabled:opacity-50"
          >Start 500</button>
          <button
            onClick={() => stopSim.mutate()}
            disabled={simStatus?.status !== 'RUNNING'}
            className="px-3 py-2 bg-warning rounded text-sm disabled:opacity-50"
          >Stop</button>
          <button
            onClick={() => resetSim.mutate()}
            className="px-3 py-2 bg-danger rounded text-sm"
          >Reset</button>
        </div>
        <ActivityFeed events={[...liveFeed, ...(feedSnapshot ?? []).map(/* map a AgentEvent */).filter(Boolean) as AgentEvent[]]} />
      </aside>
    </div>
  );
}
```

> **Nota importante:** el `useSimulator` actual del frontend genera 500 agentes locales. Mantenlo como fallback offline si `VITE_USE_MOCKS=true` o si el WS está caído. Pero cuando esté `false` y el WS abierto, los datos reales del simulador del backend deben primar.

---

## 7. Realtime — wiring por pantalla

| Pantalla | Rooms a suscribir | Eventos que importan |
|---|---|---|
| MapaPage | `city:BAQ` | `bus_position` (actualizar marcadores), `incident_reported` (pin rojo) |
| ParaderoPage | `city:BAQ` | `bus_position` (recalcular ETAs cuando un bus de las rutas listadas se mueve) |
| ViajePage | `trip:<id>` | `trip_update` (status/remainingSeconds), `bus_position` del bus específico |
| AdminPage | `admin` | TODOS los eventos |
| Pin de espera | `wait:<id>` | `wait_session_alert` (notificación toast/sonido) |

**Tip operacional:** `useRealtime` usa un socket singleton. Suscribirse a varios rooms desde diferentes componentes no abre conexiones extras. Cuando todos los componentes se desmonten, el socket cierra solo.

---

## 8. Auth UI (Signup/Login)

### 8.1 `src/components/auth/LoginForm.tsx`

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { dataSource } from '../../lib/dataSource';
import { setAuthTokens, ApiError } from '../../lib/api';
import { useAppStore } from '../../store/useAppStore';

export default function LoginForm() {
  const navigate = useNavigate();
  const setCurrentUser = useAppStore((s) => s.setCurrentUser);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const { tokens, user } = await dataSource.login({ email, password });
      setAuthTokens(tokens);
      setCurrentUser(user);
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error de red');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 p-4">
      <input
        type="email" value={email} onChange={(e) => setEmail(e.target.value)}
        placeholder="email@vialink.app" required
        className="w-full px-4 py-3 rounded-card border"
      />
      <input
        type="password" value={password} onChange={(e) => setPassword(e.target.value)}
        placeholder="Contraseña" required minLength={8}
        className="w-full px-4 py-3 rounded-card border"
      />
      {error && <p className="text-danger">{error}</p>}
      <button
        type="submit" disabled={loading}
        className="w-full bg-brand text-white py-3 rounded-card-lg font-bold disabled:opacity-50"
      >{loading ? 'Entrando…' : 'Entrar'}</button>
    </form>
  );
}
```

Similar para `SignupForm.tsx` con campo `name` extra y llamada a `dataSource.signup`.

### 8.2 Test del flujo login

```ts
// src/components/auth/LoginForm.test.tsx
import { describe, it, expect } from 'vitest';
import { renderWithProviders, screen, userEvent, waitFor } from '../../test/utils';
import LoginForm from './LoginForm';

describe('LoginForm', () => {
  it('llena tokens en localStorage tras login exitoso (mock)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginForm />);
    await user.type(screen.getByPlaceholderText(/email/i), 'test@vialink.app');
    await user.type(screen.getByPlaceholderText(/contraseña/i), 'password123');
    await user.click(screen.getByRole('button', { name: /entrar/i }));
    await waitFor(() => {
      expect(localStorage.getItem('vl-access-token')).toBeTruthy();
    });
  });
});
```

---

## 9. MSW handlers (mocks completos)

`src/lib/mockHandlers.ts` — define handlers para todos los endpoints. Estos se usan en tests **y** en desarrollo si quisieras un modo "API completamente fake" diferente al `VITE_USE_MOCKS` actual.

```ts
import { http, HttpResponse } from 'msw';
import type {
  BackendLandmarkNearbyResponse, BackendLandmarkDetail,
  BackendBusesAtPointResponse, BackendAuthSession, BackendMe,
  BackendActiveTripResponse, BackendAssistantAskResponse,
  BackendAdminMetrics, BackendRouteListResponse,
  BackendSimulatorStatus, BackendIncidentsNearbyResponse,
} from '../types/backend';

const BASE = '*/api/v1';

export const handlers = [
  // Health
  http.get('*/health', () =>
    HttpResponse.json({ status: 'ok', checks: { db: { ok: true, latencyMs: 50 } } }),
  ),

  // Landmarks
  http.get(`${BASE}/landmarks/nearby`, () =>
    HttpResponse.json<BackendLandmarkNearbyResponse>({
      landmarks: [{
        id: 'lm-uninorte', name: 'Universidad del Norte',
        type: 'UNIVERSITY', address: 'Km 5 Vía Pto Colombia',
        location: { lat: 11.0186, lng: -74.8499 },
        distance_m: 100, routes_passing_count: 3,
      }],
    }),
  ),

  http.get(`${BASE}/landmarks/:id`, ({ params }) =>
    HttpResponse.json<BackendLandmarkDetail>({
      id: params.id as string, name: 'Universidad del Norte',
      type: 'UNIVERSITY', address: 'Km 5 Vía Pto Colombia',
      location: { lat: 11.0186, lng: -74.8499 },
      routes: [
        { id: 'r-c12', code: 'C12', name: 'Centro-Uninorte',
          color: '#1E5EFF', mode: 'TRADITIONAL',
          distance_to_corridor_m: 30, status: 'OPERATING' },
      ],
    }),
  ),

  // Buses at point
  http.post(`${BASE}/buses-at-point`, async ({ request }) => {
    const body = (await request.json()) as { location: { lat: number; lng: number } };
    return HttpResponse.json<BackendBusesAtPointResponse>({
      location: body.location,
      routes: [{
        route: { id: 'r-c12', code: 'C12', name: 'Centro-Uninorte',
          color: '#1E5EFF', mode: 'TRADITIONAL', operator: 'Coochofal' },
        distance_to_corridor_m: 30,
        next_buses: [{
          bus_id: 'b-1', plate: 'ABC123',
          eta_seconds: 180, distance_m: 800,
          current_location: { lat: 11.01, lng: -74.85 },
        }],
        status: 'OPERATING',
      }],
    });
  }),

  // Routes
  http.get(`${BASE}/routes`, () =>
    HttpResponse.json<BackendRouteListResponse>({
      routes: [
        { id: 'r-c12', code: 'C12', name: 'Centro-Uninorte',
          color: '#1E5EFF', mode: 'TRADITIONAL', operator: 'Coochofal',
          landmarks_count: 28, length_km: 11.04 },
      ],
    }),
  ),

  // Auth
  http.post(`${BASE}/auth/signup`, async ({ request }) => {
    const body = (await request.json()) as { email: string; name?: string };
    return HttpResponse.json<BackendAuthSession>({
      access_token: 'mock-access',
      refresh_token: 'mock-refresh',
      user: { id: 'mock-user-1', email: body.email, name: body.name ?? null },
    }, { status: 201 });
  }),

  http.post(`${BASE}/auth/login`, async ({ request }) => {
    const body = (await request.json()) as { email: string };
    return HttpResponse.json<BackendAuthSession>({
      access_token: 'mock-access',
      refresh_token: 'mock-refresh',
      user: { id: 'mock-user-1', email: body.email, name: null },
    });
  }),

  http.get(`${BASE}/me`, () =>
    HttpResponse.json<BackendMe>({
      id: 'mock-user-1', email: 'mock@vialink.app', name: 'Mock User',
      city_code: 'BAQ', city_name: 'Barranquilla',
      favorites_count: 0, trips_count: 0,
    }),
  ),

  // Trips
  http.get(`${BASE}/trips/active`, () =>
    HttpResponse.json<BackendActiveTripResponse>({ trip: null }),
  ),

  // Assistant
  http.post(`${BASE}/assistant/ask`, async ({ request }) => {
    const body = (await request.json()) as { question: string };
    return HttpResponse.json<BackendAssistantAskResponse>({
      answer: `Mock response to: "${body.question}". Toma la C12.`,
      suggested_action: {
        type: 'START_TRIP',
        payload: {
          route_id: 'r-c12', route_code: 'C12',
          boarding_location: { lat: 11.0186, lng: -74.8499 },
          estimated_duration_seconds: 1800,
        },
      },
      latency_ms: 800,
      tool_calls: [],
    });
  }),

  // Incidents
  http.get(`${BASE}/incidents/nearby`, () =>
    HttpResponse.json<BackendIncidentsNearbyResponse>({ incidents: [] }),
  ),

  // Admin
  http.get(`${BASE}/admin/metrics`, () =>
    HttpResponse.json<BackendAdminMetrics>({
      metrics: {
        active_users: 437, active_trips: 89,
        ai_questions_per_minute: 23, incidents_last_hour: 4,
        buses_in_service: 86, active_wait_sessions: 12,
      },
      source: 'cached_2s',
    }),
  ),

  http.post(`${BASE}/admin/simulator/start`, () =>
    HttpResponse.json<BackendSimulatorStatus>({
      status: 'RUNNING', agent_count: 500,
      agents_by_profile: { STUDENT_UNINORTE: 150, STREET_VENDOR: 100 },
      actions_last_minute: 0, llm_calls_last_minute: 0,
      ticks_processed: 0, last_tick_ms: null,
      started_at: new Date().toISOString(),
    }),
  ),

  // ... agregar el resto de endpoints según se necesiten
];
```

---

## 10. Migración mocks → backend real

Tu `dataSource` ya tiene fallback automático. La migración es gradual:

1. **Inicio**: `VITE_USE_MOCKS=true`. Todo el frontend funciona con `paraderosMock`, `llmMock`, `useSimulator` local. Tests pasan con MSW.

2. **Por endpoint**: cuando quieras integrar un endpoint real, basta con que su rama "real" en `dataSource` esté implementada (sección 4). Si el backend cae, el catch hace fallback a mocks.

3. **Switch global**: cuando todo funciona contra Railway:
   ```env
   VITE_USE_MOCKS=false
   VITE_API_URL=https://vialink-backend-production.up.railway.app
   VITE_WS_URL=https://vialink-backend-production.up.railway.app
   ```

4. **Vista admin específicamente**: en vez de `useSimulator` mock, llamar a `useStartSimulator(500)` y suscribirse al room `admin`. Mantén el mock como fallback si `VITE_USE_MOCKS=true`.

---

## 11. Smoke tests vs producción

Crea un test e2e ligero que valida la conectividad antes de hacer cambios grandes:

```ts
// src/test/smoke-prod.test.ts (solo correr manualmente)
import { describe, it, expect } from 'vitest';

const PROD = 'https://vialink-backend-production.up.railway.app';

describe.skip('smoke prod (manual)', () => {
  it('health responde ok', async () => {
    const r = await fetch(`${PROD}/health`);
    const data = await r.json();
    expect(data.status).toBe('ok');
    expect(data.checks.db.ok).toBe(true);
  });

  it('buses-at-point Uninorte devuelve rutas', async () => {
    const r = await fetch(`${PROD}/api/v1/buses-at-point`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location: { lat: 11.0186, lng: -74.8499 }, radius_m: 100 }),
    });
    const data = await r.json();
    expect(data.routes.length).toBeGreaterThan(0);
  });
});
```

---

## 12. Geocoding — buscador de direcciones libres

Esta sección cubre la integración del endpoint `GET /api/v1/geocode` que
convierte direcciones libres (ej. *"Calle 84 con Cra 50"*) a coordenadas,
usando Mapbox internamente. Se agrega a la app un buscador en el mapa
principal que permite al usuario escribir una dirección y ver sugerencias
en tiempo real.

El backend ya normaliza el formato colombiano (`Calle X con Cra Y` →
`Calle X Carrera Y, Barranquilla`), expande abreviaturas (`Cra → Carrera`)
y maneja el símbolo `#`. El frontend no tiene que hacer ningún massage de
la query — basta con pasarla tal cual.

### 12.1 Contrato del endpoint

```
GET /api/v1/geocode?q=<texto>&lat=<num>&lng=<num>&limit=<int>
```

- `q` (required, 2-120 chars) — texto libre de la dirección
- `lat`, `lng` (opcional) — proximidad para sesgar resultados
- `limit` (opcional, default 5, max 10)

Endpoint **público** (no requiere Bearer).

**200 OK:**
```json
{
  "query": "Calle 84 con Cra 50",
  "results": [{
    "formatted_address": "Carrera 50 84 197, 080020 Barranquilla, Atlántico, Colombia",
    "location": { "lat": 11.0047, "lng": -74.8198 },
    "category": "address",
    "relevance": 0.8,
    "source": "mapbox" | "cache"
  }],
  "cached": false,
  "latency_ms": 380
}
```

**Errores:**
- `400` query vacía
- `404` ninguna sugerencia
- `502` Mapbox upstream error
- `503` token Mapbox no configurado (el frontend debe manejarlo
  silenciosamente — devolver `[]` y mostrar "Buscando…")

### 12.2 Tipo backend en `src/types/backend.ts`

```ts
export interface BackendGeocodeResult {
  formatted_address: string;
  location: { lat: number; lng: number };
  category: 'address' | 'street' | 'place' | 'poi'
    | 'neighborhood' | 'locality' | null;
  relevance: number;
  source: 'mapbox' | 'cache';
}

export interface BackendGeocodeResponse {
  query: string;
  results: BackendGeocodeResult[];
  cached: boolean;
  latency_ms: number;
}
```

### 12.3 Tipo producto en `src/types/index.ts`

```ts
export type GeocodeSuggestion = {
  /** Hash corto del formatted_address — útil como key en React */
  id: string;
  /** Texto corto para el item del dropdown */
  label: string;
  /** Dirección completa "Calle X, Barrio, Ciudad, ..." */
  fullAddress: string;
  location: LatLng;
  category: string | null;
};
```

### 12.4 Mapper en `src/lib/mappers.ts`

```ts
export function backendGeocodeResultToSuggestion(
  r: BackendGeocodeResult,
): GeocodeSuggestion {
  return {
    id: btoa(r.formatted_address).slice(0, 16),
    label: r.formatted_address.split(',').slice(0, 2).join(',').trim(),
    fullAddress: r.formatted_address,
    location: r.location,
    category: r.category,
  };
}
```

**Test (TDD primero):**
```ts
it('acorta el label a las primeras 2 partes de la direccion', () => {
  const s = backendGeocodeResultToSuggestion({
    formatted_address: 'Calle 84 #50-12, Norte, Barranquilla, Atlántico, Colombia',
    location: { lat: 11, lng: -74 },
    category: 'address',
    relevance: 1,
    source: 'mapbox',
  });
  expect(s.label).toBe('Calle 84 #50-12, Norte');
  expect(s.location.lat).toBe(11);
});
```

### 12.5 Método en `src/lib/dataSource.ts`

```ts
async geocode(
  query: string,
  proximity?: LatLng,
  limit = 5,
): Promise<GeocodeSuggestion[]> {
  if (USE_MOCKS) {
    // Mock: filtrar paraderosMock por nombre
    const q = query.toLowerCase();
    return paraderosMock
      .filter((p) => p.nombre.toLowerCase().includes(q))
      .slice(0, limit)
      .map((p) => ({
        id: p.id,
        label: p.nombre,
        fullAddress: p.direccion,
        location: { lat: p.lat, lng: p.lng },
        category: 'place' as const,
      }));
  }
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  if (proximity) {
    params.set('lat', proximity.lat.toString());
    params.set('lng', proximity.lng.toString());
  }
  try {
    const raw = await api.get<BackendGeocodeResponse>(`/geocode?${params}`);
    return raw.results.map(backendGeocodeResultToSuggestion);
  } catch (err) {
    // 503 (sin token Mapbox), 502 (Mapbox upstream), 404 (sin matches)
    // → caer silenciosamente a [] para no romper la UX
    if (err instanceof ApiError &&
        (err.status === 503 || err.status === 502 || err.status === 404)) {
      return [];
    }
    throw err;
  }
},
```

### 12.6 Hook con debounce en `src/hooks/useGeocode.ts`

```ts
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { dataSource } from '../lib/dataSource';
import type { LatLng } from '../types';

function useDebounced<T>(value: T, ms = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export function useGeocode(query: string, proximity?: LatLng) {
  const debouncedQuery = useDebounced(query, 350);
  const enabled = debouncedQuery.trim().length >= 3;
  return useQuery({
    queryKey: ['geocode', debouncedQuery, proximity?.lat, proximity?.lng],
    queryFn: () => dataSource.geocode(debouncedQuery, proximity, 5),
    enabled,
    staleTime: 60 * 60_000,
    gcTime: 60 * 60_000,
  });
}
```

**Tests:**
```ts
it('no consulta si query < 3 chars', () => {
  const { result } = renderHook(() => useGeocode('ab'), { wrapper });
  expect(result.current.fetchStatus).toBe('idle');
});

it('devuelve sugerencias para query >= 3 chars', async () => {
  const { result } = renderHook(() => useGeocode('Uninorte'), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.length).toBeGreaterThan(0);
});
```

### 12.7 Componente `src/components/ui/AddressSearchBar.tsx`

```tsx
import { useState } from 'react';
import { useGeocode } from '../../hooks/useGeocode';
import type { GeocodeSuggestion, LatLng } from '../../types';

type Props = {
  proximity?: LatLng;
  onSelect: (s: GeocodeSuggestion) => void;
  placeholder?: string;
};

export default function AddressSearchBar({ proximity, onSelect, placeholder }: Props) {
  const [q, setQ] = useState('');
  const [focused, setFocused] = useState(false);
  const { data: suggestions, isFetching } = useGeocode(q, proximity);
  const open = focused && (q.length >= 3 || (suggestions?.length ?? 0) > 0);

  return (
    <div className="relative w-full">
      <input
        type="text" value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        placeholder={placeholder ?? '¿A dónde vas?'}
        className="w-full px-4 py-3 rounded-card bg-surface-base border
                   border-text-secondary/20 text-text-primary"
        data-testid="address-search-input"
      />
      {open && (
        <ul className="absolute top-full left-0 right-0 mt-1 bg-surface-base
                       rounded-card shadow-lg max-h-64 overflow-y-auto z-50">
          {isFetching && (
            <li className="px-4 py-3 text-text-secondary text-sm">Buscando…</li>
          )}
          {!isFetching && suggestions?.length === 0 && q.length >= 3 && (
            <li className="px-4 py-3 text-text-secondary text-sm">
              No encontramos esa dirección
            </li>
          )}
          {suggestions?.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onSelect(s); setQ(s.label); setFocused(false); }}
                className="w-full text-left px-4 py-3 hover:bg-surface-raised
                           border-b border-text-secondary/10"
                data-testid="address-suggestion"
              >
                <div className="font-medium text-text-primary">{s.label}</div>
                <div className="text-xs text-text-secondary truncate">{s.fullAddress}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

### 12.8 Integración en `src/pages/MapaPage.tsx`

```tsx
// Reutiliza el state `setTapped` que ya dispara POST /buses-at-point
// (ver sección 6.1). Agrega encima del MapView un buscador flotante:

<div className="absolute top-4 left-4 right-4 z-30">
  <AddressSearchBar
    proximity={userLocation ?? undefined}
    onSelect={(s) => {
      setTapped(s.location); // dispara el bottom sheet con buses-at-point
      // Opcional: mapRef.current?.flyTo([s.location.lat, s.location.lng], 16);
    }}
  />
</div>
```

### 12.9 MSW handler en `src/lib/mockHandlers.ts`

```ts
http.get(`${BASE}/geocode`, ({ request }) => {
  const url = new URL(request.url);
  const q = url.searchParams.get('q') ?? '';
  return HttpResponse.json<BackendGeocodeResponse>({
    query: q,
    results: [{
      formatted_address: `${q}, Barranquilla, Atlántico, Colombia`,
      location: { lat: 11.018, lng: -74.85 },
      category: 'address',
      relevance: 0.9,
      source: 'mapbox',
    }],
    cached: false,
    latency_ms: 50,
  });
}),
```

### 12.10 Integración con el asistente Claude (sin cambios en frontend)

El asistente del backend ya integra `geocode_address` internamente. Si el
usuario pregunta al chat *"¿Cómo llego a la Calle 84 con Cra 50?"*, Claude
cadena `find_landmark` (origen) + `geocode_address` (destino) + `calculate_trip`
y devuelve la respuesta natural + `suggested_action`. **El frontend no tiene
que llamar `/geocode` por su cuenta para esto** — solo seguir consumiendo
`POST /assistant/ask` como ya hace.

### 12.11 Limitaciones conocidas

| Tipo de query | ¿Funciona? | Por qué |
|---|---|---|
| Direcciones formales BAQ (`Calle X con Cra Y`, `Calle X #N-M`) | ✅ Sí | Mapbox v6 indexa el dataset oficial |
| Avenidas con nombre (`Avenida Olaya Herrera`) | ⚠️ A veces | Mapbox no tiene todas las avenidas tagged |
| POIs (`Uninorte`, `Estadio Metropolitano`, `Buenavista`) | ❌ No | Mapbox no indexa POIs de BAQ en su free tier. **Usa `find_landmark` para esto** (los 80 landmarks pre-cargados del backend cubren esto) |
| Esquinas referenciadas | ⚠️ Mediocre | Mapbox interpola pero la precisión cae a 1-2 cuadras |

**Regla pragmática:** el buscador debe combinar `useGeocode` (Mapbox)
con `useLandmarkSearch` (los 80 nuestros). Si los dos devuelven, fusiona
los resultados en una sola lista priorizando los landmarks (son más
relevantes para Vialink).

---

## 13. Click en bus → modal con info + ruta + ETA

Cuando el usuario tap en un `BusMarker` del mapa, abrimos un sheet/modal
con la información completa del bus + dibujamos el polyline de su ruta
en el mapa + mostramos ETA al usuario si tiene ubicación, sino al próximo
landmark.

### 13.1 Contrato del endpoint

```
GET /api/v1/buses/:id/details?lat=<float>&lng=<float>
```

| Param | Tipo | Required | Notas |
|---|---|---|---|
| `:id` | UUID (path) | ✅ | ID del bus |
| `lat`, `lng` | float (query) | ❌ | Ubicación del usuario; si presentes, agrega `eta_to_user` |

Endpoint **público** (no requiere Bearer).
**Cache:** 1s TTL en backend, key = `busId:lat:lng`. Absorbe re-clicks rápidos.

**Response 200:**
```ts
{
  bus: {
    id: string,
    plate: string,
    location: { lat: number, lng: number },
    heading: number | null,
    speed_kmh: number,
    fraction_of_corridor: number,    // 0.0 - 1.0
    status: 'IN_SERVICE',
    last_seen_at: string,            // ISO
  },
  route: {
    id: string,
    code: string,                    // "C12"
    name: string,                    // "Centro - Uninorte"
    color: string,                   // "#1E5EFF"
    mode: 'TRADITIONAL' | 'BRT' | 'METRO',
    operator: string | null,         // "Coochofal"
    length_km: number,               // 17.65
  },
  polyline: {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [number, number][]  // [lng, lat][], GeoJSON estándar
    },
    properties: { route_id: string, code: string, color: string }
  },
  next_landmark: {                   // null si bus está cerca del final
    id: string,
    name: string,                    // "Universidad del Norte"
    type: string,                    // "UNIVERSITY"
    location: { lat: number, lng: number },
    eta_seconds: number | null,      // null si bus está detenido
    distance_m: number,
  } | null,
  eta_to_user: {                     // null si no se pasó lat/lng o el bus ya pasó
    eta_seconds: number | null,
    distance_m: number,
    nearest_corridor_point: { lat: number, lng: number },
  } | null,
  stats: {
    completed_km: number,
    completed_pct: number,           // 0.0 - 1.0
    remaining_km: number,
  }
}
```

**Errores:**
| Status | Cuándo | Frontend qué hace |
|---|---|---|
| `400` | UUID inválido | Toast genérico |
| `404` | Bus no existe en DB | Cerrar modal, toast "Bus no disponible" |
| `410` | Bus completó recorrido / OUT_OF_SERVICE | Mostrar "Bus completó su recorrido" en el modal + deshabilitar CTAs |

### 13.2 Tipo backend en `src/types/backend.ts`

```ts
export interface BackendBusDetailsResponse {
  bus: {
    id: string;
    plate: string;
    location: { lat: number; lng: number };
    heading: number | null;
    speed_kmh: number;
    fraction_of_corridor: number;
    status: 'IN_SERVICE' | 'OUT_OF_SERVICE' | 'BREAK';
    last_seen_at: string;
  };
  route: {
    id: string;
    code: string;
    name: string;
    color: string;
    mode: BackendRouteMode;
    operator: string | null;
    length_km: number;
  };
  polyline: BackendCorridorGeoJSON;
  next_landmark: {
    id: string;
    name: string;
    type: string;
    location: { lat: number; lng: number };
    eta_seconds: number | null;
    distance_m: number;
  } | null;
  eta_to_user: {
    eta_seconds: number | null;
    distance_m: number;
    nearest_corridor_point: { lat: number; lng: number };
  } | null;
  stats: {
    completed_km: number;
    completed_pct: number;
    remaining_km: number;
  };
}
```

### 13.3 Tipo producto en `src/types/index.ts`

```ts
export type BusDetails = {
  bus: {
    id: string;
    plate: string;
    location: LatLng;
    heading: number | null;
    speedKmh: number;
    fractionOfCorridor: number;
    status: 'IN_SERVICE' | 'OUT_OF_SERVICE' | 'BREAK';
    lastSeenAt: string;
  };
  route: {
    id: string;
    code: string;
    name: string;
    color: string;
    mode: string;
    operator: string | null;
    lengthKm: number;
  };
  /** Coordinates ya en orden [lat, lng] (Leaflet). Backend devuelve GeoJSON [lng, lat]. */
  polylineLatLng: [number, number][];
  nextLandmark: {
    id: string;
    name: string;
    type: string;
    location: LatLng;
    etaSeconds: number | null;
    distanceM: number;
  } | null;
  etaToUser: {
    etaSeconds: number | null;
    distanceM: number;
    nearestCorridorPoint: LatLng;
  } | null;
  stats: {
    completedKm: number;
    completedPct: number;
    remainingKm: number;
  };
};
```

### 13.4 Mapper en `src/lib/mappers.ts`

```ts
import type { BackendBusDetailsResponse } from '../types/backend';
import type { BusDetails } from '../types';

export function backendBusDetailsToBusDetails(
  r: BackendBusDetailsResponse,
): BusDetails {
  return {
    bus: {
      id: r.bus.id,
      plate: r.bus.plate,
      location: r.bus.location,
      heading: r.bus.heading,
      speedKmh: r.bus.speed_kmh,
      fractionOfCorridor: r.bus.fraction_of_corridor,
      status: r.bus.status,
      lastSeenAt: r.bus.last_seen_at,
    },
    route: {
      id: r.route.id,
      code: r.route.code,
      name: r.route.name,
      color: r.route.color,
      mode: r.route.mode,
      operator: r.route.operator,
      lengthKm: r.route.length_km,
    },
    // Flip de GeoJSON [lng, lat] a Leaflet [lat, lng]
    polylineLatLng: r.polyline.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    nextLandmark: r.next_landmark
      ? {
          id: r.next_landmark.id,
          name: r.next_landmark.name,
          type: r.next_landmark.type,
          location: r.next_landmark.location,
          etaSeconds: r.next_landmark.eta_seconds,
          distanceM: r.next_landmark.distance_m,
        }
      : null,
    etaToUser: r.eta_to_user
      ? {
          etaSeconds: r.eta_to_user.eta_seconds,
          distanceM: r.eta_to_user.distance_m,
          nearestCorridorPoint: r.eta_to_user.nearest_corridor_point,
        }
      : null,
    stats: {
      completedKm: r.stats.completed_km,
      completedPct: r.stats.completed_pct,
      remainingKm: r.stats.remaining_km,
    },
  };
}
```

**Test (TDD primero):**
```ts
it('mapea bus_details + flip polyline lng,lat → lat,lng', () => {
  const r: BackendBusDetailsResponse = {
    bus: { id: 'b1', plate: 'ABC123',
      location: { lat: 11, lng: -74 },
      heading: 90, speed_kmh: 25, fraction_of_corridor: 0.5,
      status: 'IN_SERVICE', last_seen_at: '2026-05-23T...' },
    route: { id: 'r1', code: 'C12', name: 'X', color: '#1E5EFF',
      mode: 'TRADITIONAL', operator: 'Coochofal', length_km: 17.65 },
    polyline: {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[-74.8, 11.0], [-74.81, 11.01]] },
      properties: { route_id: 'r1', code: 'C12', color: '#1E5EFF' },
    },
    next_landmark: null,
    eta_to_user: null,
    stats: { completed_km: 8.8, completed_pct: 0.5, remaining_km: 8.85 },
  };
  const out = backendBusDetailsToBusDetails(r);
  expect(out.bus.speedKmh).toBe(25);
  expect(out.polylineLatLng).toEqual([[11.0, -74.8], [11.01, -74.81]]);
});
```

### 13.5 Método en `src/lib/dataSource.ts`

```ts
async getBusDetails(busId: string, userLocation?: LatLng): Promise<BusDetails> {
  if (USE_MOCKS) {
    // Mock simple: usa primera ruta + primer paradero
    const paradero = paraderosMock[0];
    return {
      bus: { id: busId, plate: 'MOCK123',
        location: { lat: paradero.lat, lng: paradero.lng },
        heading: 0, speedKmh: 25, fractionOfCorridor: 0.3,
        status: 'IN_SERVICE', lastSeenAt: new Date().toISOString() },
      route: { id: 'mock-route', code: 'C12', name: 'Centro-Uninorte',
        color: '#1E5EFF', mode: 'TRADITIONAL', operator: 'Coochofal', lengthKm: 17.65 },
      polylineLatLng: [[paradero.lat, paradero.lng], [paradero.lat + 0.01, paradero.lng]],
      nextLandmark: { id: paradero.id, name: paradero.nombre, type: 'NEIGHBORHOOD',
        location: { lat: paradero.lat, lng: paradero.lng },
        etaSeconds: 240, distanceM: 800 },
      etaToUser: userLocation ? { etaSeconds: 320, distanceM: 1200,
        nearestCorridorPoint: { lat: paradero.lat, lng: paradero.lng } } : null,
      stats: { completedKm: 5.3, completedPct: 0.3, remainingKm: 12.35 },
    };
  }
  const params = userLocation
    ? `?lat=${userLocation.lat}&lng=${userLocation.lng}`
    : '';
  const raw = await api.get<BackendBusDetailsResponse>(`/buses/${busId}/details${params}`);
  return backendBusDetailsToBusDetails(raw);
},
```

### 13.6 Hook en `src/hooks/useBusDetails.ts`

```ts
import { useQuery } from '@tanstack/react-query';
import { dataSource } from '../lib/dataSource';
import type { LatLng } from '../types';

export function useBusDetails(busId: string | null, userLocation?: LatLng) {
  return useQuery({
    queryKey: ['bus-details', busId, userLocation?.lat, userLocation?.lng],
    queryFn: () => dataSource.getBusDetails(busId!, userLocation),
    enabled: !!busId,
    // SOLO snapshot inicial: el bus se anima en el polyline via WS bus_position
    staleTime: Infinity,
    refetchInterval: false,
    retry: (failureCount, error) => {
      // No reintentar 404 ni 410
      if (error instanceof Error && /404|410/.test(error.message)) return false;
      return failureCount < 1;
    },
  });
}
```

### 13.7 Componente `src/components/map/BusDetailSheet.tsx`

```tsx
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useBusDetails } from '../../hooks/useBusDetails';
import { useCreateWaitSession } from '../../hooks/useWaitSession';
import { useAppStore } from '../../store/useAppStore';
import BottomSheet from '../ui/BottomSheet';
import type { LatLng } from '../../types';

interface Props {
  busId: string | null;
  onClose: () => void;
}

export default function BusDetailSheet({ busId, onClose }: Props) {
  const navigate = useNavigate();
  const userLat = useAppStore((s) => s.userLat);
  const userLng = useAppStore((s) => s.userLng);
  const userLocation: LatLng | undefined =
    userLat != null && userLng != null ? { lat: userLat, lng: userLng } : undefined;

  const { data: details, isLoading, error } = useBusDetails(busId, userLocation);
  const createWait = useCreateWaitSession();

  if (!busId) return null;

  if (isLoading) {
    return (
      <BottomSheet onClose={onClose}>
        <div className="p-6 text-text-secondary">Cargando…</div>
      </BottomSheet>
    );
  }

  // Manejo de 410 — bus completó recorrido
  const errorMsg = error instanceof Error ? error.message : '';
  if (/410/.test(errorMsg)) {
    return (
      <BottomSheet onClose={onClose}>
        <div className="p-6 text-center">
          <p className="font-medium">Este bus completó su recorrido</p>
          <button onClick={onClose} className="mt-4 px-4 py-2 bg-brand text-white rounded-card">
            Cerrar
          </button>
        </div>
      </BottomSheet>
    );
  }

  if (!details) return null;

  const hasUserLocation = !!userLocation;
  const showEta = hasUserLocation && details.etaToUser?.etaSeconds != null;
  const showNextLandmark = !showEta && details.nextLandmark?.etaSeconds != null;

  async function handleAvisame() {
    if (!hasUserLocation || !details) return;
    await createWait.mutateAsync({
      location: userLocation!,
      route_id: details.route.id,
      notify_seconds_before: 180,
    });
    // Mostrar toast "Te avisaremos cuando esté cerca"
    onClose();
  }

  return (
    <BottomSheet onClose={onClose}>
      <div className="p-4 space-y-4">
        {/* Header */}
        <div>
          <div className="flex items-baseline gap-2">
            <span
              className="px-3 py-1 rounded-card-lg text-white text-sm font-bold"
              style={{ backgroundColor: details.route.color }}
            >
              {details.route.code}
            </span>
            <span className="font-medium">{details.route.name}</span>
          </div>
          <p className="text-sm text-text-secondary mt-1">
            Placa {details.bus.plate} · {details.route.operator}
          </p>
        </div>

        {/* Hero ETA */}
        <div className="bg-surface-raised rounded-card p-4 text-center">
          {showEta ? (
            <>
              <p className="text-text-secondary text-sm">Llega a ti en</p>
              <p className="text-3xl font-bold text-brand">
                {Math.max(1, Math.round(details.etaToUser!.etaSeconds! / 60))} min
              </p>
              <p className="text-xs text-text-secondary">
                {details.etaToUser!.distanceM} m de distancia
              </p>
            </>
          ) : showNextLandmark ? (
            <>
              <p className="text-text-secondary text-sm">Próxima parada</p>
              <p className="text-xl font-bold">{details.nextLandmark!.name}</p>
              <p className="text-sm text-brand">
                en {Math.max(1, Math.round(details.nextLandmark!.etaSeconds! / 60))} min
              </p>
            </>
          ) : (
            <p className="text-text-secondary">Sin información de tiempo</p>
          )}
        </div>

        {/* Progress bar */}
        <div>
          <div className="flex justify-between text-xs text-text-secondary mb-1">
            <span>{details.stats.completedKm} km recorridos</span>
            <span>{details.stats.remainingKm} km restantes</span>
          </div>
          <div className="h-2 bg-surface-raised rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-brand"
              initial={{ width: 0 }}
              animate={{ width: `${details.stats.completedPct * 100}%` }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
            />
          </div>
        </div>

        {/* CTA */}
        <button
          onClick={handleAvisame}
          disabled={!hasUserLocation || createWait.isPending}
          title={!hasUserLocation ? 'Activa tu ubicación primero' : undefined}
          className="w-full bg-brand text-white py-3 rounded-card-lg font-bold disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {createWait.isPending ? 'Creando aviso…' : 'Avísame cuando llegue'}
        </button>
      </div>
    </BottomSheet>
  );
}
```

### 13.8 Integración en `MapaPage.tsx`

```tsx
import { useState, useEffect } from 'react';
import { Polyline } from 'react-leaflet';
import BusDetailSheet from '../components/map/BusDetailSheet';
import { useBusDetails } from '../hooks/useBusDetails';
import { useRealtime } from '../hooks/useRealtime';

export default function MapaPage() {
  // ... estado existente
  const [selectedBusId, setSelectedBusId] = useState<string | null>(null);
  const userLocation = /* ... */;
  const { data: busDetails } = useBusDetails(selectedBusId, userLocation);

  // Suscribirse al room del bus específico para animarlo en vivo
  useRealtime({
    rooms: selectedBusId ? [`bus:${selectedBusId}`] : [],
    enabled: !!selectedBusId,
    handlers: {
      bus_position: (event) => {
        if (event.busId !== selectedBusId) return;
        // Tu lógica existente de animar el bus en el mapa ya lo cubre
      },
    },
  });

  return (
    <div className="w-full h-screen relative">
      <MapView
        center={...}
        paraderos={...}
        buses={buses.map((b) => ({
          ...b,
          highlighted: b.id === selectedBusId, // opacidad 1 vs 0.5
        }))}
        onBusClick={(busId) => setSelectedBusId(busId)}
      >
        {/* Polyline solo cuando hay bus seleccionado */}
        {busDetails && (
          <Polyline
            positions={busDetails.polylineLatLng}
            pathOptions={{
              color: busDetails.route.color,
              weight: 5,
              opacity: 0.8,
            }}
          />
        )}
      </MapView>

      <BusDetailSheet
        busId={selectedBusId}
        onClose={() => setSelectedBusId(null)}
      />
    </div>
  );
}
```

### 13.9 MSW handler en `src/lib/mockHandlers.ts`

```ts
http.get(`${BASE}/buses/:id/details`, ({ params, request }) => {
  const url = new URL(request.url);
  const hasUserLoc = url.searchParams.has('lat') && url.searchParams.has('lng');
  return HttpResponse.json<BackendBusDetailsResponse>({
    bus: {
      id: params.id as string,
      plate: 'MCK456',
      location: { lat: 11.012, lng: -74.812 },
      heading: 245,
      speed_kmh: 28,
      fraction_of_corridor: 0.34,
      status: 'IN_SERVICE',
      last_seen_at: new Date().toISOString(),
    },
    route: { id: 'r1', code: 'C12', name: 'Centro - Uninorte',
      color: '#1E5EFF', mode: 'TRADITIONAL', operator: 'Coochofal', length_km: 17.65 },
    polyline: {
      type: 'Feature',
      geometry: { type: 'LineString',
        coordinates: [[-74.78, 10.96], [-74.81, 11.0], [-74.85, 11.02]] },
      properties: { route_id: 'r1', code: 'C12', color: '#1E5EFF' },
    },
    next_landmark: {
      id: 'lm-uninorte', name: 'Universidad del Norte', type: 'UNIVERSITY',
      location: { lat: 11.018, lng: -74.851 },
      eta_seconds: 240, distance_m: 1200,
    },
    eta_to_user: hasUserLoc ? {
      eta_seconds: 320, distance_m: 1500,
      nearest_corridor_point: { lat: 11.015, lng: -74.849 },
    } : null,
    stats: { completed_km: 6.0, completed_pct: 0.34, remaining_km: 11.65 },
  });
}),
```

### 13.10 Notas de UX

- **Performance del Polyline:** Leaflet renderiza 519 puntos sin problema. Si en algún momento se ve laggy, usa `<canvas>` en vez de SVG: `<Polyline renderer={L.canvas()} ...>`.
- **Cuando se cierra el sheet**, asegúrate de unsetear `selectedBusId` → el `useRealtime` se desuscribe automáticamente y el Polyline desaparece.
- **Si hay un trip activo** del usuario en una ruta diferente, no romper esa suscripción WS — `useRealtime` con singleton de socket lo maneja bien.
- **El bus seleccionado** debe destacarse visualmente sobre los demás (otros buses con `opacity: 0.4`, el seleccionado `opacity: 1` + borde).

### Sesión típica

1. Abres Cursor/Claude con este doc adjunto + el repo del frontend abierto.
2. Le das el system prompt de §0 al agente.
3. Le pides: *"Implementa el setup de Vitest siguiendo la sección 2. Cuando termines, corre `pnpm test` y muéstrame los resultados."*
4. Verificas que pase. Commit.
5. Le pides: *"Ahora implementa los mappers de la sección 3. Escribe los tests primero, luego el código. Asegúrate que todos pasen."*
6. Iteras así, una sección por commit, validando que tests pasan después de cada uno.

### Si algo se atasca

> *"El test X falla con [pega error]. Revisa la implementación que hicimos y la sección Y del doc. Sugiéreme una corrección sin reescribir nada que no haga falta."*

### Si el agente quiere reescribir algo que NO debe tocar

> *"NO modifiques `src/lib/api.ts` ni `src/hooks/useRealtime.ts`. Esos archivos están definidos como inmutables en la sección 1 del doc. Adáptate a ellos."*

### Para acelerar features grandes

> *"Implementa secciones 4.2 + 5.1 + 6.1 en orden, una a la vez. Después de cada una corre `pnpm test` y solo continúa si pasa todo."*

---

## Apéndice B: Mapping rápido pantalla → endpoints → WS rooms

| Pantalla | REST endpoints | WS rooms | Eventos relevantes |
|---|---|---|---|
| **Mapa principal** | `GET /landmarks/nearby`, `POST /buses-at-point`, `GET /routes/:id/buses`, **`GET /geocode`** (buscador) | `city:BAQ` | `bus_position`, `incident_reported` |
| **Detalle paradero** | `GET /landmarks/:id`, `POST /buses-at-point` | `city:BAQ` | `bus_position` |
| **Asistente IA** | `POST /assistant/ask`, `GET /assistant/messages` | — | — |
| **Viaje activo** | `POST /trips`, `GET /trips/active`, `PATCH /trips/:id`, `POST /trips/:id/rating`, `GET /routes/:id/corridor.geojson` | `trip:<id>` | `trip_update`, `bus_position` |
| **Pin de espera** | `POST /wait-sessions`, `DELETE /wait-sessions/:id` | `wait:<id>` | `wait_session_alert` |
| **Admin (pitch)** | `GET /admin/metrics`, `GET /admin/feed`, `POST /admin/simulator/start` | `admin` | TODOS |
| **Auth + perfil** | `POST /auth/signup`, `POST /auth/login`, `POST /auth/refresh`, `GET /me`, `POST/DELETE /me/favorites` | — | — |
| **Incidentes** | `POST /incidents`, `GET /incidents/nearby` | `city:BAQ` | `incident_reported` |
| **Geocoding** | **`GET /geocode`** (público) | — | — |

---

## Cierre

Este documento es la **fuente de verdad** para implementar el frontend de Vialink contra el backend real. Si encuentras una inconsistencia entre lo que dice este doc y el backend, **avisa antes de adaptar** — probablemente el backend tenga el comportamiento correcto y este doc tenga que actualizarse.

Backend en producción: **https://vialink-backend-production.up.railway.app**
Swagger interactivo: **https://vialink-backend-production.up.railway.app/api/docs**
Contacto: David Palacio (backend lead).
