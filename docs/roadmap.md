# Vialink Backend — Roadmap 48h

> Plan ejecutable. Cada bloque tiene entregable verificable. Si me retraso >2h en un bloque, recorto el siguiente.

---

## Bloque 0 · Setup (0–3h)

**Objetivo**: backend NestJS conectado a Supabase con migración aplicada, hello-world en Railway, Swagger arriba.

- [ ] Crear proyecto en Supabase (`vialink-hackathon`), habilitar PostGIS
- [ ] Instalar deps: `prisma`, `@prisma/client`, `@nestjs/config`, `@nestjs/swagger`, `class-validator`, `class-transformer`, `helmet`, `nestjs-pino`, `@nestjs/throttler`, `@anthropic-ai/sdk`, `@supabase/supabase-js`, `socket.io`, `@nestjs/websockets`, `@nestjs/platform-socket.io`, `@nestjs/event-emitter`, `@nestjs/schedule`
- [ ] Crear `prisma/schema.prisma` con todos los models del documento de arquitectura
- [ ] `.env.example` + `.env` local
- [ ] `PrismaModule` + `PrismaService`
- [ ] Bootstrap en `main.ts`: CORS, Helmet, ValidationPipe global, Swagger en `/api/docs`, prefix `/api/v1`
- [ ] Endpoint `GET /health` retornando `{ status: 'ok', db: 'connected', uptime }`
- [ ] Aplicar migration inicial (`prisma migrate dev --name init`)
- [ ] Migration SQL raw con índices PostGIS
- [ ] Deploy a Railway, verificar `/health` y `/api/docs` desde URL pública

**Definition of done**: URL pública de Railway responde `/health` con `db: connected`.

---

## Bloque 1 · Seed Barranquilla (3–7h)

**Objetivo**: datos creíbles para que la app se vea viva desde el primer endpoint.

- [ ] `prisma/seeds/cities.ts` — ciudad BAQ con `center` y `bbox`
- [ ] `prisma/seeds/landmarks.ts` — 80 landmarks reales de BAQ con coords verificadas en Google Maps:
  - Universidades (Uninorte, Universidad del Atlántico, UniLibre, CUC, UniSimón Bolívar)
  - Centros comerciales (Buenavista I y II, Único, Viva, Portal del Prado, Mall Plaza)
  - Hospitales (Universitario CARI, Niño Jesús, Reina Catalina)
  - Plazas y zonas (Plaza San Nicolás, Paseo Bolívar, Carnaval, Olímpica Murillo, Estadio Metropolitano)
  - Hubs de transporte (Terminal de Transportes, Aeropuerto Cortissoz)
  - Barrios populares (Centro, El Prado, Riomar, Olaya Herrera, La Manga, Soledad)
- [ ] `prisma/seeds/routes.ts` — 14 rutas tradicionales con corridors dibujados:
  - Ej. C12 (Uninorte-Centro), B7 (Norte-Sur), R20 (Soledad-Centro), etc.
  - Corridors como GeoJSON LineString con 30-60 puntos cada uno
  - Asignar landmarks cercanos a cada ruta (RouteLandmark con `fractionOfCorridor`)
- [ ] `prisma/seeds/transmetro.ts` — 2 rutas BRT (T1, T2) con paradas fijas reales
- [ ] `prisma/seeds/buses.ts` — 4-8 buses por ruta tradicional con posición inicial aleatoria en el corridor
- [ ] `prisma/seeds/cached-walking-paths.ts` — pre-cálculo de paths entre landmarks principales (script aparte que consulta Mapbox y guarda)
- [ ] `pnpm run seed` ejecuta todo en orden

**Definition of done**: query `SELECT count(*) FROM routes` retorna 16, `landmarks` retorna 80, `buses` retorna ~80, todos con geometrías válidas.

---

## Bloque 2 · Discovery + WebSocket + BusEngine (7–14h) ⭐ BLOQUE GRANDE

**Objetivo**: lo necesario para que el mapa del frontend vea **buses moviéndose en tiempo real desde el primer día**. Esto incluye discovery REST + infraestructura WS + BusEngine moviendo los buses del seed.

### 2.A · Discovery endpoints (7–10h)
- [ ] `CitiesModule`, `LandmarksModule`, `RoutesModule`, `DiscoveryModule`
- [ ] **POST `/buses-at-point`** — query PostGIS con `ST_DWithin` y `ST_LineLocatePoint`, retornando rutas + próximos buses + ETAs
  - Cache en memoria TTL 3s (clave: lat/lng redondeada a 4 decimales + radius)
- [ ] **GET `/routes/nearby`** — versión ligera
- [ ] **GET `/landmarks/nearby`** — con PostGIS, ordenado por distancia
- [ ] **GET `/landmarks/:id`** — incluye rutas que pasan
- [ ] **GET `/landmarks/search?q=`** — fuzzy match con `pg_trgm`
- [ ] **GET `/routes`** — listar con filtro por modo
- [ ] **GET `/routes/:id`** — detalle + landmarks ordenados por `fractionOfCorridor`
- [ ] **GET `/routes/:id/corridor.geojson`** — GeoJSON LineString
- [ ] **GET `/routes/:id/buses`** — buses activos
- [ ] Swagger anotaciones en todos los DTOs
- [ ] Postman collection auto-generada desde Swagger

### 2.B · Realtime infrastructure (10–12h)
- [ ] `RealtimeModule` con `RealtimeGateway` (Socket.io)
- [ ] Sistema de rooms: `admin`, `city:<code>`, `bus:<id>`, `trip:<id>`, `wait:<id>`
- [ ] `RealtimeEventBusService` — wrapper sobre `EventEmitter2` para emitir eventos tipados
- [ ] Eventos definidos: `bus_position`, `incident_reported`, `trip_update`, `wait_session_alert`, `agent_action`, `metrics_update`
- [ ] Health del WS: endpoint `GET /realtime/health` retorna conteo de conexiones por room
- [ ] Test manual con cliente `socket.io-client` consumiendo desde Node script

### 2.C · BusEngine core (12–14h)
- [ ] `BusesModule` con `BusesService` (CRUD básico)
- [ ] `BusEngineService` con `@Interval(SIMULATOR_BUS_TICK_MS)`:
  - Lee todos los buses `IN_SERVICE`
  - Avanza `fractionOfCorridor` según `speedKmh`
  - Recalcula GPS con `ST_LineInterpolatePoint` (SQL raw)
  - Bulk update con `UPDATE ... FROM (VALUES (...)) AS new_data WHERE ...`
  - Emite `bus.position_updated` por bus al EventBus
- [ ] `RealtimeGateway` escucha y broadcasta a rooms apropiadas
- [ ] Endpoint admin temporal: `POST /admin/buses/spawn?route_id=&count=` para añadir buses ad-hoc (útil para tuning del pitch)

**Definition of done**:
1. Sebastián abre el frontend → ve los 80+ buses del seed moviéndose en el mapa **en vivo** (sin recargar)
2. Postman + Swagger públicos
3. Cliente WS con `socket.io-client` recibe `bus_position` cada 1s con datos consistentes con GET `/routes/:id/buses`

**Sync con Sebastián**: pasarle Postman + URL de `/api/docs` + ejemplo de cliente WS funcionando.

---

## Bloque 3 · Auth + perfil (14–16h)

**Objetivo**: signup/login funcionando con Supabase, perfil del usuario.

- [ ] `AuthModule` — `AuthService` proxy a Supabase Auth admin API
- [ ] `POST /auth/signup`, `POST /auth/login`, `POST /auth/refresh`
- [ ] `SupabaseJwtGuard` que valida JWT en cada request
- [ ] `@CurrentUser()` decorator
- [ ] `@Public()` decorator para endpoints sin auth
- [ ] `UsersModule` — `GET /me`, `POST/DELETE /me/favorites`, `GET /me/favorites`
- [ ] Trigger Supabase: cuando `auth.users` crea un user, también crear `profiles` row

**Definition of done**: signup desde Swagger → token válido → llamar `/me` con Bearer → retorna perfil.

---

## Bloque 4 · Trips + Wait Sessions + Incidents (16–22h)

**Objetivo**: ciclo completo de viaje con pin de espera. Todo emite WS desde el primer día.

- [ ] `TripsModule` — `POST /trips`, `GET /trips/active`, `PATCH /trips/:id`, `POST /trips/:id/rating`
  - Índice parcial DB: `CREATE UNIQUE INDEX one_active_trip ON trips(user_id) WHERE status='IN_PROGRESS'`
  - Cada cambio emite `trip.started` / `trip.updated` / `trip.completed` al EventBus
- [ ] `WaitSessionsModule` — `POST /wait-sessions`, `DELETE /wait-sessions/:id`
- [ ] `WaitSessionMatcherService` (scheduled cada 5s): revisa wait_sessions activas vs posiciones actuales de buses; cuando hay match dentro de `notify_seconds_before`, emite `wait_session.alert` (idempotente con update conditional WHERE status='WAITING')
- [ ] `IncidentsModule` — `POST /incidents` emite `incident.reported`, `GET /incidents/nearby`
- [ ] Todos los eventos pasan por `RealtimeEventBus` (ya implementado en Bloque 2.B)

**Definition of done**: end-to-end con cliente WS:
- Cliente A crea wait_session
- BusEngine mueve un bus → matcher detecta proximidad → cliente A recibe `wait_session_alert` via WS
- Cliente B reporta incident → cliente C (suscrito a `city:BAQ`) lo ve aparecer en su mapa

---

## Bloque 5 · Asistente Claude con tools (22–28h)

**Objetivo**: asistente conversacional con function calling sobre los endpoints reales.

- [ ] `AssistantModule`
- [ ] `AssistantService.ask()` con loop de tool use:
  - System prompt en español neutro colombiano
  - Tools: `find_routes_near`, `find_landmark`, `get_buses_at_point`, `calculate_trip`
  - Max 5 iteraciones de tool use
  - Retornar `answer` + `suggested_action` parseada de la respuesta de Claude
- [ ] `POST /assistant/ask`
- [ ] `GET /assistant/messages` (historial)
- [ ] Logging de tool calls + latencia
- [ ] Rate limit (5 req/min por user)

**Definition of done**: preguntar "¿Cómo llego al Centro?" desde Uninorte → respuesta natural con `suggested_action: START_TRIP` y ruta correcta.

---

## Bloque 6 · Simulador 500 agentes (28–36h)

**Objetivo**: 500 agentes vivos ejecutando acciones REALES contra los services del backend.

⚠️ Nota: el `BusEngine` ya está corriendo desde Bloque 2.C. Aquí solo se agrega la lógica de los agentes que **consumen** la API y generan tráfico real.

- [ ] `SimulatorModule`
- [ ] 6 perfiles en `simulator/profiles/`
- [ ] `WalkingPathsService` — Mapbox/ORS + cache en tabla `cached_walking_paths`
- [ ] `AgentEngine.tick(agent)` — máquina de estados:
  - `IDLE` → genera próximo destino según perfil + hora → `WALKING`
  - `WALKING` → interpola posición sobre walking_path → cuando llega al corridor → `WAITING_BUS`
  - `WAITING_BUS` → 10% probabilidad pregunta a Claude (via AssistantService); espera bus cercano; cuando bus pasa → `ON_BUS`
  - `ON_BUS` → posición sigue a bus.location; cuando llega a destino → `AT_DESTINATION`
  - `AT_DESTINATION` → completa trip via TripsService; 70% probabilidad califica via RatingsService; → `IDLE`
- [ ] **Cada acción del agente llama un service real** (no shortcuts al Prisma):
  - `tripsService.createTrip({ actorType: 'AGENT', actorId: agent.id, ... })`
  - `assistantService.ask({ actorType: 'AGENT', actorId: agent.id, ... })`
  - `incidentsService.report({ actorType: 'AGENT', ... })`
- [ ] `POST /admin/simulator/start`, `POST /admin/simulator/stop`, `GET /admin/simulator/status`
- [ ] Logs de costos LLM (tokens, $)
- [ ] Agentes emiten `agent_action` event (visible solo en room `admin`)

**Definition of done**:
1. Arrancar simulador con 100 agentes (smoke), luego escalar a 500
2. Abrir el frontend admin → ver agentes haciendo acciones, feed lleno
3. Abrir el frontend usuario → la app se ve "viva" con paraderos populares y reportes generados por agentes
4. `simulator_events` table llenándose con varias acciones por segundo

---

## Bloque 7 · Vista admin (métricas + feed) (36–40h)

**Objetivo**: terminar el frontend admin del pitch — métricas en grande, feed de actividad streaming.

⚠️ La infraestructura WS y eventos ya están corriendo desde Bloque 2.B. Aquí solo se agregan los endpoints REST admin y el polling de métricas.

- [ ] `MetricsService` — scheduled cada 2s, calcula:
  - `active_users` (sesiones WS activas en room `city:BAQ`)
  - `active_trips` (trips status=IN_PROGRESS)
  - `ai_questions_per_minute` (count assistant_messages last 60s)
  - `incidents_last_hour`
  - `buses_in_service`
- [ ] Emite `metrics_update` cada 2s al room `admin`
- [ ] `AdminController`:
  - `GET /admin/metrics` — snapshot puntual
  - `GET /admin/feed?limit&since` — feed paginado de simulator_events + acciones reales
  - Endpoints de simulator (ya hechos en bloque 6)
- [ ] Tunning final: rate limiting WS, validación de auth para room `admin`

**Definition of done**: vista admin del frontend muestra mapa con 500 puntos + 80 buses moviéndose + feed streaming + 4 cards de métricas que cambian cada 2s.

---

## Bloque 8 · Polish + Stress test + Deploy prod (40–46h)

**Objetivo**: backend robusto para soportar simulador + jurado consumiendo al mismo tiempo sin caídas.

- [ ] **Stress test crítico**: `autocannon -c 50 -d 60 http://localhost:3000/api/v1/buses-at-point` con simulador corriendo
  - Target: P95 < 500ms, 0 errores 5xx
  - Si falla: agregar cache más agresivo, optimizar query PostGIS
- [ ] WebSocket stress: 100 clientes WS conectados + simulador → verificar broadcast latency < 100ms
- [ ] Global exception filter (ya hecho en Bloque 0) — verificar shape consistente
- [ ] Logging estructurado (Pino, ya hecho) — agregar request_id
- [ ] Healthcheck robusto (verifica DB + Anthropic API)
- [ ] Connection pool tuning en Prisma (`connection_limit` y `pool_timeout`)
- [ ] Deploy final a Railway, verificar todas las URLs públicas
- [ ] Variables de entorno en Railway dashboard
- [ ] Postman collection final actualizada
- [ ] Documentación API actualizada en `docs/api-contract.md`
- [ ] Sebastián: validación end-to-end con frontend prod desde celular real

**Definition of done**: URL pública de Railway, frontend Vercel consumiendo, simulador con 500 agentes + 10 humanos conectados sin caídas durante 5 minutos seguidos.

---

## Bloque 9 · Demo prep (46–48h)

**Objetivo**: pitch sin sorpresas.

- [ ] Script de "reset demo": stop simulador → clear `simulator_events` → restart simulador → datos limpios para mostrar
- [ ] Pre-cargar dataset "horas pico" para que en el pitch se vean muchos agentes
- [ ] Video backup de 60s del flujo completo (por si falla red durante pitch)
- [ ] Documento "qué decir si X falla"
- [ ] Verificar acceso desde celular del jurado (responsive, latencia desde su red)

---

## Riesgos identificados y mitigación

| Riesgo | Mitigación |
|---|---|
| Mapbox/ORS rate limit | Pre-cálculo de paths en seed, cache infinita |
| Claude latencia alta | Modelo Haiku (~1s típico), timeout 8s, fallback "intenta de nuevo" |
| 500 agentes saturan DB | Bulk inserts, batching cada 1s, índices correctos |
| WebSocket no escala | Socket.io con cluster adapter si pasamos de 100 clientes (no llegamos en pitch) |
| Migration falla en prod | Probar migration localmente con DB fresca antes de deploy |
| Datos seed malos | Verificar visualmente en mapa cada landmark/corridor antes de seguir |
| Falta tiempo bloque 6 | Recortar a 100 agentes iniciales, escalar a 500 si alcanza |

---

_Owner: David Palacio · Última actualización: arranque hackatón_
