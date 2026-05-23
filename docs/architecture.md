# Vialink Backend — Arquitectura

> Documento interno · David Palacio · Hackatón 48h

---

## 1 · Stack consolidado

| Capa | Tecnología | Justificación |
|---|---|---|
| Framework | NestJS 11 + TypeScript | Ya viene el scaffold; estructura modular sólida |
| ORM | Prisma 5 | Mejor DX que TypeORM, migraciones limpias, type-safety |
| DB | Postgres 15+ en Supabase | PostGIS habilitado para queries geoespaciales |
| Auth | Supabase Auth (email + password) | Manejo de JWT delegado, sin construir auth desde cero |
| Realtime | Socket.io vía `@nestjs/websockets` | Más simple que WS nativo, fallbacks automáticos |
| LLM | `@anthropic-ai/sdk` con Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) | Rápido, barato, buen español, function calling |
| Walking paths | Mapbox Directions API (perfil walking) o OpenRouteService | Pre-cálculo en seed, cache infinita |
| Validación | `class-validator` + `class-transformer` | Estándar Nest |
| Docs API | `@nestjs/swagger` | Auto-generación en `/api/docs` |
| Rate limit | `@nestjs/throttler` | Protección básica |
| Logging | `nestjs-pino` | Performance, JSON structured |
| Deploy | Railway (backend), Supabase (DB) | Setup en minutos, Postgres administrado |

---

## 2 · Estructura de carpetas

```
src/
├── main.ts                  # bootstrap: Nest factory, CORS, Swagger, helmet
├── app.module.ts            # root module
├── prisma/                  # PrismaService global
├── common/                  # decorators, filters, dto, guards
├── config/                  # zod env validation
├── realtime/                # ⭐ infra core, no feature
│   ├── realtime.module.ts
│   ├── realtime.gateway.ts         # Socket.io gateway con rooms
│   └── realtime-event-bus.service.ts # wrapper EventEmitter2 → WS
├── buses/                   # ⭐ infra core, NO parte del simulador
│   ├── buses.module.ts
│   ├── buses.service.ts            # CRUD + queries
│   ├── eta.service.ts              # cálculos ETA
│   └── bus-engine.service.ts       # ⭐ scheduled cada 1s, mueve TODOS los buses IN_SERVICE
│                                   # emite bus.position_updated → WS broadcast
├── auth/                    # Supabase JWT guard + signup/login
├── users/                   # /me, /me/favorites
├── cities/                  # multi-ciudad (solo BAQ seeded)
├── routes/                  # /routes, /routes/:id, /routes/:id/corridor.geojson
├── landmarks/               # /landmarks/:id, /landmarks/search
├── discovery/               # buses-at-point, routes/nearby, landmarks/nearby
│                            # ⭐ CACHE en memoria TTL 3s para buses-at-point
├── trips/                   # POST /trips, GET /trips/active, PATCH
├── wait-sessions/           # pin de espera con notificación WS
├── incidents/               # reportes, emite incident_reported WS
├── ratings/                 # POST /trips/:id/rating
├── assistant/
│   ├── assistant.module.ts
│   ├── assistant.controller.ts
│   ├── assistant.service.ts
│   └── tools/               # function-calling tools de Claude
├── simulator/               # SOLO lógica de agentes (NO el bus-engine)
│   ├── simulator.module.ts
│   ├── simulator.service.ts        # start/stop orquestador
│   ├── agent.engine.ts             # ciclo de vida de un agente
│   ├── profiles/                   # 6 perfiles
│   └── walking-paths.service.ts    # cache de Mapbox
└── admin/
    ├── admin.module.ts
    ├── admin.controller.ts          # /admin/metrics, /admin/feed, start/stop sim
    └── metrics.service.ts           # scheduled cada 2s, emite metrics_update WS
```

**Cambios clave del rediseño**:
- `realtime/` y `buses/` son **infraestructura core**, presentes desde el Bloque 2 — no esperan al simulador
- `BusEngine` corre siempre (incluso sin simulador encendido) → buses del seed se mueven al levantar el backend
- Todo service que muta estado emite evento al `RealtimeEventBus` → el gateway lo broadcasta a rooms relevantes

---

## 3 · Schema de base de datos

### Extensiones requeridas
```sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

### Tablas

```prisma
// schema.prisma (resumen, ver archivo completo)

model City {
  id        String   @id @default(uuid())
  code      String   @unique // 'BAQ'
  name      String
  center    Unsupported("geography(Point, 4326)")
  bbox      Unsupported("geography(Polygon, 4326)")?
  createdAt DateTime @default(now())

  routes      Route[]
  landmarks   Landmark[]
  profiles    Profile[]
}

model Profile {
  id        String   @id @default(uuid())  // matches auth.users.id
  email     String   @unique
  name      String?
  deviceId  String?
  cityId    String
  city      City     @relation(fields: [cityId], references: [id])
  createdAt DateTime @default(now())

  trips        Trip[]
  favorites    Favorite[]
  waitSessions WaitSession[]
  ratings      Rating[]
  incidents    Incident[]
  messages     AssistantMessage[]
}

enum RouteMode {
  TRADITIONAL
  BRT
  METRO
}

model Route {
  id            String    @id @default(uuid())
  code          String    // 'C12'
  name          String
  color         String    // '#1E5EFF'
  mode          RouteMode @default(TRADITIONAL)
  stopsAreFixed Boolean   @default(false)
  operator      String?
  cityId        String
  city          City      @relation(fields: [cityId], references: [id])
  active        Boolean   @default(true)

  corridor      RouteCorridor?
  buses         Bus[]
  trips         Trip[]
  landmarks     RouteLandmark[]
  fixedStops    FixedStop[]   // solo BRT/METRO
  incidents     Incident[]

  @@unique([cityId, code])
  @@index([cityId, mode])
}

model RouteCorridor {
  routeId   String @id
  route     Route  @relation(fields: [routeId], references: [id], onDelete: Cascade)
  path      Unsupported("geography(LineString, 4326)")
  lengthM   Int
  direction String @default("OUTBOUND")
  // INDEX GIST(path) — agregar con SQL raw en migration
}

enum LandmarkType {
  UNIVERSITY
  MALL
  HOSPITAL
  SQUARE
  TRANSPORT_HUB
  NEIGHBORHOOD
  LANDMARK
}

model Landmark {
  id        String       @id @default(uuid())
  name      String
  type      LandmarkType
  address   String?
  location  Unsupported("geography(Point, 4326)")
  cityId    String
  city      City         @relation(fields: [cityId], references: [id])

  routes    RouteLandmark[]
  favorites Favorite[]

  @@index([cityId])
}

model RouteLandmark {
  routeId             String
  landmarkId          String
  distanceToCorridorM Int
  fractionOfCorridor  Float  // 0.0 - 1.0
  route               Route    @relation(fields: [routeId], references: [id])
  landmark            Landmark @relation(fields: [landmarkId], references: [id])

  @@id([routeId, landmarkId])
  @@index([routeId, fractionOfCorridor])
}

// Solo para BRT/METRO (Transmetro)
model FixedStop {
  id        String   @id @default(uuid())
  routeId   String
  route     Route    @relation(fields: [routeId], references: [id])
  name      String
  code      String?
  sequence  Int
  location  Unsupported("geography(Point, 4326)")
  fractionOfCorridor Float

  @@unique([routeId, sequence])
}

enum BusStatus {
  IN_SERVICE
  OUT_OF_SERVICE
  BREAK
}

model Bus {
  id                 String    @id @default(uuid())
  routeId            String
  route              Route     @relation(fields: [routeId], references: [id])
  plate              String
  currentLocation    Unsupported("geography(Point, 4326)")
  fractionOfCorridor Float     @default(0)
  speedKmh           Float     @default(0)
  heading            Float?
  lastSeenAt         DateTime  @default(now())
  status             BusStatus @default(IN_SERVICE)

  trips    Trip[]
  positions BusPosition[]

  @@index([routeId, status])
}

model BusPosition {
  id                 String    @id @default(uuid())
  busId              String
  bus                Bus       @relation(fields: [busId], references: [id])
  location           Unsupported("geography(Point, 4326)")
  fractionOfCorridor Float
  speedKmh           Float
  recordedAt         DateTime  @default(now())

  @@index([busId, recordedAt])
}

enum TripStatus {
  IN_PROGRESS
  COMPLETED
  CANCELLED
}

model Trip {
  id                  String    @id @default(uuid())
  userId              String
  user                Profile   @relation(fields: [userId], references: [id])
  routeId             String
  route               Route     @relation(fields: [routeId], references: [id])
  busId               String?
  bus                 Bus?      @relation(fields: [busId], references: [id])
  boardingLocation    Unsupported("geography(Point, 4326)")
  dropoffLocation     Unsupported("geography(Point, 4326)")
  boardingLandmarkId  String?
  dropoffLandmarkId   String?
  startedAt           DateTime  @default(now())
  endedAt             DateTime?
  estimatedArrivalAt  DateTime?
  status              TripStatus @default(IN_PROGRESS)

  rating Rating?
  @@index([userId, status])
}

enum WaitStatus {
  WAITING
  ALERTED
  BOARDED
  CANCELLED
  EXPIRED
}

model WaitSession {
  id                 String     @id @default(uuid())
  userId             String
  user               Profile    @relation(fields: [userId], references: [id])
  routeId            String?
  waitLocation       Unsupported("geography(Point, 4326)")
  notifySecondsBefore Int       @default(180)
  status             WaitStatus @default(WAITING)
  startedAt          DateTime   @default(now())
  endedAt            DateTime?
  alertedBusId       String?

  @@index([status, startedAt])
}

enum IncidentType {
  TRAFFIC
  FULL_BUS
  NO_BUS_PASSING
  ACCIDENT
}

model Incident {
  id          String       @id @default(uuid())
  userId      String?
  user        Profile?     @relation(fields: [userId], references: [id])
  routeId     String?
  route       Route?       @relation(fields: [routeId], references: [id])
  type        IncidentType
  location    Unsupported("geography(Point, 4326)")
  description String?
  reportedAt  DateTime     @default(now())

  @@index([reportedAt])
}

model Rating {
  id        String   @id @default(uuid())
  userId    String
  user      Profile  @relation(fields: [userId], references: [id])
  tripId    String   @unique
  trip      Trip     @relation(fields: [tripId], references: [id])
  stars     Int      // 1-5
  comment   String?
  createdAt DateTime @default(now())
}

enum FavoriteTarget {
  LANDMARK
  ROUTE
}

model Favorite {
  id         String         @id @default(uuid())
  userId     String
  user       Profile        @relation(fields: [userId], references: [id])
  targetType FavoriteTarget
  landmarkId String?
  landmark   Landmark?      @relation(fields: [landmarkId], references: [id])
  routeId    String?
  alias      String?
  createdAt  DateTime       @default(now())

  @@unique([userId, targetType, landmarkId, routeId])
}

model AssistantMessage {
  id               String   @id @default(uuid())
  userId           String
  user             Profile  @relation(fields: [userId], references: [id])
  question         String
  answer           String
  suggestedAction  Json?
  latencyMs        Int?
  toolCalls        Json?    // qué tools usó Claude
  createdAt        DateTime @default(now())

  @@index([userId, createdAt])
}

// ===== SIMULATOR =====

enum AgentProfile {
  STUDENT_UNINORTE
  STREET_VENDOR
  EXECUTIVE_NORTE
  HOUSEWIFE_SURORIENTE
  TOURIST
  NIGHTLIFE_ATTENDEE
}

enum AgentStatus {
  IDLE
  WALKING
  WAITING_BUS
  ON_BUS
  AT_DESTINATION
}

model SimulatorAgent {
  id            String         @id @default(uuid())
  profileType   AgentProfile
  name          String
  homeLocation  Unsupported("geography(Point, 4326)")
  workLocation  Unsupported("geography(Point, 4326)")?
  schedule      Json           // {weekday_routine, peak_hours, ...}
  status        AgentStatus    @default(IDLE)
  currentLocation Unsupported("geography(Point, 4326)")?
  currentRouteId String?
  currentTripId  String?
  createdAt     DateTime       @default(now())

  events SimulatorEvent[]

  @@index([profileType, status])
}

model SimulatorEvent {
  id         String   @id @default(uuid())
  agentId    String
  agent      SimulatorAgent @relation(fields: [agentId], references: [id])
  actionType String   // 'walked' | 'started_waiting' | 'boarded' | 'asked_ai' | ...
  payload    Json
  location   Unsupported("geography(Point, 4326)")?
  occurredAt DateTime @default(now())

  @@index([occurredAt])
  @@index([agentId, occurredAt])
}

// Cache de walking paths (pre-calculados con Mapbox)
model CachedWalkingPath {
  id          String   @id @default(uuid())
  fromGeohash String   // geohash precision 7 (~150m)
  toGeohash   String
  path        Unsupported("geography(LineString, 4326)")
  distanceM   Int
  durationS   Int
  computedAt  DateTime @default(now())

  @@unique([fromGeohash, toGeohash])
  @@index([fromGeohash])
}
```

### Índices PostGIS (en migration SQL raw)

```sql
CREATE INDEX idx_route_corridors_path ON route_corridors USING GIST(path);
CREATE INDEX idx_landmarks_location ON landmarks USING GIST(location);
CREATE INDEX idx_buses_location ON buses USING GIST(current_location);
CREATE INDEX idx_incidents_location ON incidents USING GIST(location);
CREATE INDEX idx_trips_boarding ON trips USING GIST(boarding_location);
CREATE INDEX idx_wait_sessions_location ON wait_sessions USING GIST(wait_location);

CREATE INDEX idx_landmarks_name_trgm ON landmarks USING GIN(name gin_trgm_ops);
```

---

## 4 · Lógica clave: cálculo de buses en un punto

```sql
-- Función SQL: get_routes_at_point(point geography, radius int)
WITH nearby_routes AS (
  SELECT
    r.*,
    rc.path,
    rc.length_m,
    ST_LineLocatePoint(rc.path::geometry, $point::geometry) AS my_fraction,
    ST_Distance(rc.path, $point) AS distance_to_corridor_m
  FROM routes r
  JOIN route_corridors rc ON rc.route_id = r.id
  WHERE r.city_id = $city_id
    AND r.active = true
    AND ST_DWithin(rc.path, $point, $radius_m)
)
SELECT
  nr.*,
  -- Próximos buses (que aún no han pasado mi punto)
  (
    SELECT json_agg(
      json_build_object(
        'bus_id', b.id,
        'plate', b.plate,
        'distance_m', (nr.my_fraction - b.fraction_of_corridor) * nr.length_m,
        'eta_seconds', CASE
          WHEN b.speed_kmh > 1
          THEN ((nr.my_fraction - b.fraction_of_corridor) * nr.length_m) / (b.speed_kmh * 1000.0 / 3600.0)
          ELSE NULL
        END,
        'current_location', json_build_object('lat', ST_Y(b.current_location::geometry), 'lng', ST_X(b.current_location::geometry))
      )
      ORDER BY (nr.my_fraction - b.fraction_of_corridor) ASC
    )
    FROM buses b
    WHERE b.route_id = nr.id
      AND b.status = 'IN_SERVICE'
      AND b.fraction_of_corridor < nr.my_fraction
      AND b.last_seen_at > NOW() - INTERVAL '5 minutes'
    LIMIT 3
  ) AS next_buses
FROM nearby_routes nr;
```

Esta query se encapsula en `DiscoveryService.getBusesAtPoint()`.

---

## 4.5 · BusEngine — buses moviéndose en tiempo real

**Componente CORE**, independiente del simulador. Corre desde que se levanta el backend.

### Diseño

```ts
@Injectable()
export class BusEngine {
  @Interval(1000)  // tick cada 1s
  async tick() {
    const buses = await this.prisma.bus.findMany({
      where: { status: 'IN_SERVICE' },
      include: { route: { include: { corridor: true } } },
    });

    const updates = buses.map((bus) => {
      // Avanza fracción según velocidad real (km/h del bus)
      const metersAdvanced = (bus.speedKmh * 1000) / 3600;
      const newFraction = (bus.fractionOfCorridor +
        metersAdvanced / bus.route.corridor.lengthM) % 1;

      // Interpola GPS sobre el corridor
      const newLocation = ST_LineInterpolatePoint(corridor.path, newFraction);

      return { id: bus.id, fractionOfCorridor: newFraction, currentLocation: newLocation };
    });

    // Bulk update con SQL raw (mejor performance que Promise.all)
    await this.bulkUpdateBuses(updates);

    // Emite eventos al EventBus
    for (const u of updates) {
      this.eventBus.emit('bus.position_updated', { ...u, routeId, cityCode: 'BAQ' });
    }
  }
}
```

### Tick rate

| Frecuencia | Pros | Contras |
|---|---|---|
| **1 segundo** ⭐ default | Movimiento muy fluido en mapa | ~80 buses × 60 ticks/min = 4,800 events/min |
| 2 segundos | Mitad de carga | Aún fluido con interpolación frontend |
| 3 segundos | Mínima carga | Movimiento perceptiblemente discreto sin interpolación |

**Estrategia frontend**: interpolar entre posiciones recibidas con `framer-motion` o `requestAnimationFrame` durante el TICK_MS. Independiente del tick, el bus se ve moviéndose suavemente.

### WS broadcast

```ts
@OnEvent('bus.position_updated')
onBusPositionUpdated(event) {
  // Broadcast a todos los clientes en la ciudad del bus
  this.server.to(`city:${event.cityCode}`).emit('bus_position', event);
  // Si hay viaje activo con este bus, también a esa room
  this.server.to(`bus:${event.busId}`).emit('bus_position', event);
}
```

---

## 4.6 · Concurrencia y estrés esperado

500 agentes + N humanos (jurado, equipo) golpean la API simultáneamente. Diseño defensivo:

### DB connection pooling
- Supabase pgbouncer en **transaction mode** (puerto 6543)
- Prisma con `?pgbouncer=true&connection_limit=10`
- Migrations usan `DIRECT_URL` (puerto 5432, sin pooler) para soportar prepared statements

### Cache de endpoints calientes
- `POST /buses-at-point` será el más golpeado (mapa del frontend lo dispara cada vez que el usuario mueve el viewport)
- Cache en memoria con TTL 3s, key = `${roundedLat}:${roundedLng}:${radius}`
- Implementación: `cache-manager` con LRU 1000 entries

### Race conditions críticas
| Operación | Riesgo | Mitigación |
|---|---|---|
| Dos `POST /trips` concurrentes del mismo user | Dos viajes activos a la vez | Índice parcial: `CREATE UNIQUE INDEX one_active_trip ON trips(user_id) WHERE status='IN_PROGRESS'` |
| BusEngine actualiza bus + endpoint lee bus | Read inconsistente | Acceptable: snapshot semantics suficiente para hackatón |
| Wait session alertada dos veces | Notificación duplicada | `UPDATE wait_sessions SET status='ALERTED' WHERE id=$1 AND status='WAITING' RETURNING *` (idempotente) |

### Rate limiting
- Global: 120 req/min por IP (`@nestjs/throttler` ya configurado)
- Asistente Claude: 5 req/min por user (es caro)
- WS: max 10 connections por IP

### Stress test plan
En Bloque 8: `autocannon -c 50 -d 30 http://localhost:3000/api/v1/buses-at-point` simulando jurados, + simulador corriendo. Target: P95 < 500ms, 0 errores 5xx.

---

## 5 · Simulador — arquitectura

### Filosofía: tráfico real, no datos fake

Los 500 agentes no son llamadas mágicas internas. Cada agente ejecuta acciones contra los **mismos services** que usan los endpoints HTTP. La única diferencia con un usuario humano es que el agente tiene `simulator_agent_id` en lugar de `user_id` autenticado (decisión pragmática: evitar crear 500 users en Supabase Auth solo para fakes).

Resultado: desde la perspectiva del WS broadcast, no hay diferencia entre un evento generado por un agente vs un humano real. La demo se ve idéntica a producción.

### Diseño general

```
SimulatorService (singleton, encendible/apagable)
  ├─ startSimulation({count: 500})
  │    ├─ Crea N agentes con perfiles aleatorios distribuidos
  │    └─ Schedule tick cada SIMULATOR_TICK_MS (default 1000ms)
  ├─ AgentEngine.tick(agent)
  │    ├─ Determina próxima acción según perfil + hora + estado
  │    └─ Ejecuta acción contra services reales:
  │         - WalkingPathsService.walkTo(agent, destination)
  │         - DiscoveryService.getBusesAtPoint()
  │         - TripsService.startTrip(simulatorAgentId: agent.id)
  │         - AssistantService.ask() (10% probabilidad cuando aplica)
  │         - IncidentsService.report()
  │    └─ Cada service emite evento WS (igual que llamada HTTP real)
  └─ SimulatorEventsLogger
       └─ Suscrito al EventBus → guarda en simulator_events table para feed admin

⚠️ BusEngine NO está aquí. Es servicio core independiente — ver §6.
```

### Acción del agente = llamada real

Por ejemplo, cuando un agente "inicia un viaje":

```ts
// En lugar de:
await this.prisma.trip.create({ ... });  // ❌ shortcut

// Hace:
await this.tripsService.createTrip({     // ✅ misma lógica que POST /trips
  routeId, boardingLocation, dropoffLocation,
  actorType: 'SIMULATOR_AGENT',
  actorId: agent.id,
});
// → TripsService valida, persiste, emite trip_started al EventBus
// → RealtimeGateway broadcasta a rooms 'admin' y 'city:BAQ'
```

Esto garantiza que cualquier bug encontrado por agentes también se reproduzca para humanos.

### Perfiles base (6)

| Perfil | Comportamiento |
|---|---|
| `STUDENT_UNINORTE` | Casa→Uninorte 6:30am, Uninorte→Casa 5pm. Pregunta sobre rutas. Reporta buses llenos. |
| `STREET_VENDOR` | Centro→puntos turísticos 8am-6pm. Múltiples viajes cortos. Calificaciones variadas. |
| `EXECUTIVE_NORTE` | Casa→Norte 7am. Pregunta cosas más complejas. Califica alto. |
| `HOUSEWIFE_SURORIENTE` | Casa→Mercado, Casa→Hospital, viajes esporádicos. Reporta trancones. |
| `TOURIST` | Hotel→atracciones. Pregunta MUCHO al asistente. Califica todo. |
| `NIGHTLIFE_ATTENDEE` | Casa→Centro 8pm, Centro→Casa 1am. Pocos agentes pero activos en noche. |

### Distribución temporal

Los agentes activan/desactivan según hora del día (simulada o real):
- 6-9am: pico mañana (estudiantes, ejecutivos)
- 9-12: vendedores, amas de casa
- 12-2pm: pico almuerzo
- 2-5pm: tarde tranquila
- 5-7pm: pico tarde (todos)
- 7pm-12am: nightlife
- 12-6am: solo nightlife residual

Para el pitch, usaremos un `speed_multiplier` (ej. 4x) para que en 15 min se vea un día completo.

---

## 6 · Asistente IA — function calling

### Tools expuestas a Claude

```ts
// Tool 1: find_routes_near
{
  name: 'find_routes_near',
  description: 'Encuentra rutas de bus que pasan cerca de una ubicación',
  input_schema: {
    location: { lat, lng },
    radius_m: number
  }
}

// Tool 2: find_landmark
{
  name: 'find_landmark',
  description: 'Busca un lugar/punto popular por nombre (Uninorte, Olímpica, Centro, etc.)',
  input_schema: { query: string }
}

// Tool 3: get_buses_at_point
{
  name: 'get_buses_at_point',
  description: 'Obtiene los próximos buses que pasan por un punto específico',
  input_schema: { location: { lat, lng } }
}

// Tool 4: calculate_trip
{
  name: 'calculate_trip',
  description: 'Calcula tiempo y ruta entre dos puntos/landmarks',
  input_schema: { from: { lat, lng } | { landmark_id }, to: { lat, lng } | { landmark_id } }
}
```

### Loop

```
1. Usuario pregunta: "Cómo llego al Centro si voy de afán"
2. Claude recibe system prompt + pregunta + ubicación
3. Claude decide: usar find_landmark("Centro") → backend retorna landmark
4. Claude decide: usar calculate_trip(from=user_location, to=centro_landmark)
5. Backend retorna mejores opciones (C12 en 4min, B7 en 8min)
6. Claude formula respuesta natural en español + suggested_action
7. Frontend recibe respuesta + acción CTA
```

System prompt incluye: instrucción de hablar en español neutro colombiano, ser conciso, siempre ofrecer una acción concreta, no inventar datos.

---

## 7 · WebSocket — diseño

### Gateway

```ts
@WebSocketGateway({ cors: true, path: '/realtime' })
export class RealtimeGateway {
  @SubscribeMessage('subscribe')
  handleSubscribe(client, { room }) {
    // Validar permisos: 'admin' requiere role admin
    client.join(room);
  }

  // EventBus internal events → emit a Socket.io rooms
  @OnEvent('simulator.agent_action')
  onAgentAction(event) {
    this.server.to('admin').emit('agent_action', event);
  }

  @OnEvent('bus.position_updated')
  onBusPosition(event) {
    this.server.to(['admin', `city:${event.cityCode}`]).emit('bus_position', event);
    // También a viajes activos en ese bus
    this.server.to(`trip:${event.activeTripId}`).emit('bus_position', event);
  }
}
```

### EventBus

`EventEmitter2` (built-in Nest). Cualquier service puede:
```ts
this.eventBus.emit('simulator.agent_action', { ... });
```

Y el gateway escucha y broadcasta.

---

## 8 · Variables de entorno

```env
# Server
PORT=3000
NODE_ENV=development
CORS_ORIGINS=http://localhost:5173,https://vialink.vercel.app

# Database (Supabase)
DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true
DIRECT_URL=postgresql://postgres.[ref]:[password]@aws-0-us-east-1.pooler.supabase.com:5432/postgres

# Supabase API
SUPABASE_URL=https://[ref].supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_JWT_SECRET=...

# LLM
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-haiku-4-5-20251001

# Walking paths
MAPBOX_ACCESS_TOKEN=pk....
# o OPENROUTESERVICE_API_KEY=...

# Simulator
SIMULATOR_DEFAULT_AGENTS=500
SIMULATOR_LLM_PROBABILITY=0.1
SIMULATOR_TICK_MS=1000
```

---

## 9 · Deploy

### Railway
- Auto-deploy from GitHub `main` branch
- Build: `pnpm install && pnpm prisma generate && pnpm build`
- Start: `pnpm prisma migrate deploy && pnpm start:prod`
- Env vars manuales en Railway dashboard
- Healthcheck: `/health`

### Supabase
- Proyecto `vialink-hackathon` en región más cercana (us-east-1)
- Habilitar extensión PostGIS desde dashboard o migration
- Connection pooler (PgBouncer) para `DATABASE_URL`, direct connection para migrations

---

## 10 · Métricas de éxito técnico

- API P95 < 300ms en endpoints discovery
- Asistente IA P95 < 3s (Claude Haiku)
- 500 agentes corriendo sin colas
- WS broadcast a 100+ clientes simultáneos sin lag
- Schema multi-ciudad funcional (aunque solo seeded BAQ)
- Cero errores 5xx durante el pitch de 5min

---

_Última actualización: arranque · este es documento vivo._
