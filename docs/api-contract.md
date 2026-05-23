# Vialink — API Contract para Frontend

> **Para:** Sebastián (Frontend Lead) · **Por:** David (Backend) · **Hackatón 48h**
> 
> Documento vivo. Si algo cambia en la implementación, actualizo este archivo y aviso.

---

## 0 · Contexto del modelo de datos (lee esto primero)

Vialink NO modela paraderos fijos para buses tradicionales. La realidad colombiana:

- **Buses tradicionales** (foco principal): no tienen paraderos, paran en cualquier punto del recorrido cuando alguien levanta la mano.
- **Transmetro (BRT)**: sí tiene paradas fijas. Lo incluimos pero como modo secundario.

Por eso el modelo central es:

| Entidad | Qué representa |
|---|---|
| `route` | Una ruta: código (C12), color, modo (`TRADITIONAL` / `BRT`), operador |
| `route_corridor` | La línea geográfica (polyline) por donde circulan los buses de esa ruta |
| `landmark` | Punto de referencia conocido (Uninorte, Olímpica, Buenavista). **En la UI lo llamamos "Punto popular" o "Lugar"** — NO "paradero" |
| `bus` | Vehículo moviéndose por su corridor |
| `wait_session` | Cuando el usuario "marca un punto" para esperar (recibe notificación cuando hay bus cerca) |
| `trip` | Un viaje en curso. `boarding_location` y `dropoff_location` son puntos arbitrarios (lat, lng), no IDs de paradero |

---

## 1 · Convenciones generales

- **Base URL**: `https://api.vialink.app/api/v1` (prod) · `http://localhost:3000/api/v1` (local)
- **Auth**: `Authorization: Bearer <jwt>` (Supabase JWT). Endpoints sin auth marcados con `🔓`.
- **Formato fechas**: ISO 8601 UTC (`2026-05-23T14:30:00Z`)
- **Coordenadas**: GeoJSON-style `{lat: number, lng: number}` (NO `[lng, lat]` salvo en respuestas GeoJSON crudas)
- **Distancias**: metros (números enteros)
- **Tiempos**: segundos (números enteros) salvo cuando son fechas
- **Errores**: formato uniforme
  ```json
  { "statusCode": 404, "message": "Route not found", "error": "NotFound" }
  ```
- **Paginación**: query params `?limit=20&cursor=<opaque>` → respuesta incluye `next_cursor`
- **Documentación interactiva**: Swagger en `/api/docs` (siempre actualizado, fuente de verdad)

---

## 2 · Autenticación

### POST `/auth/signup` 🔓

Crea usuario en Supabase y devuelve sesión.

**Request:**
```json
{ "email": "user@vialink.app", "password": "min8chars", "name": "Sebastián" }
```

**201:**
```json
{
  "access_token": "eyJhbGc...",
  "refresh_token": "...",
  "user": { "id": "uuid", "email": "...", "name": "Sebastián" }
}
```

### POST `/auth/login` 🔓

Mismo shape de respuesta que signup.

**Request:** `{ "email": "...", "password": "..." }`

### GET `/me`

**200:**
```json
{
  "id": "uuid",
  "email": "...",
  "name": "Sebastián",
  "favorites_count": 3,
  "trips_count": 12,
  "city_code": "BAQ"
}
```

---

## 3 · Discovery — encontrar buses desde cualquier punto

### POST `/buses-at-point` 🔓

**El endpoint estrella.** El usuario hace tap en cualquier punto del mapa y obtiene qué rutas pasan + cuándo viene el próximo bus.

**Request:**
```json
{ "location": { "lat": 11.0041, "lng": -74.8070 }, "radius_m": 100 }
```

**200:**
```json
{
  "location": { "lat": 11.0041, "lng": -74.8070 },
  "routes": [
    {
      "route": {
        "id": "uuid",
        "code": "C12",
        "color": "#1E5EFF",
        "name": "Uninorte - Centro",
        "mode": "TRADITIONAL",
        "operator": "Coochofal"
      },
      "distance_to_corridor_m": 12,
      "next_buses": [
        {
          "bus_id": "uuid",
          "plate": "URD123",
          "eta_seconds": 240,
          "distance_m": 1200,
          "current_location": { "lat": 11.012, "lng": -74.812 }
        },
        {
          "bus_id": "uuid",
          "plate": "ABC789",
          "eta_seconds": 780,
          "distance_m": 3900,
          "current_location": { "lat": 11.025, "lng": -74.821 }
        }
      ],
      "status": "OPERATING"
    }
  ]
}
```

**Notas para frontend:**
- Si `next_buses` está vacío → renderiza "Sin buses activos en este momento"
- `status: 'LOW_FREQUENCY'` cuando hay <1 bus por 15 min
- `status: 'OFFLINE'` si no hay buses en la ruta en absoluto

### GET `/routes/nearby` 🔓

Versión "ligera" del anterior: solo lista de rutas cercanas, sin info de buses.

**Query:** `?lat=11.0041&lng=-74.8070&radius_m=100`

**200:**
```json
{
  "routes": [
    { "id": "uuid", "code": "C12", "color": "#1E5EFF", "name": "...", "mode": "TRADITIONAL", "distance_m": 12 }
  ]
}
```

### GET `/landmarks/nearby` 🔓

Para mostrar anclajes visuales en el mapa.

**Query:** `?lat=11.0041&lng=-74.8070&radius_m=1000&limit=20`

**200:**
```json
{
  "landmarks": [
    {
      "id": "uuid",
      "name": "Universidad del Norte",
      "type": "UNIVERSITY",
      "location": { "lat": 11.018, "lng": -74.851 },
      "distance_m": 245,
      "routes_passing_count": 5
    }
  ]
}
```

`type` enum: `UNIVERSITY | MALL | HOSPITAL | SQUARE | TRANSPORT_HUB | NEIGHBORHOOD | LANDMARK`

### GET `/landmarks/:id` 🔓

**200:**
```json
{
  "id": "uuid",
  "name": "Universidad del Norte",
  "type": "UNIVERSITY",
  "address": "Km 5 Vía Puerto Colombia",
  "location": { "lat": 11.018, "lng": -74.851 },
  "routes": [
    {
      "id": "uuid", "code": "C12", "color": "#1E5EFF", "name": "Uninorte - Centro",
      "distance_to_corridor_m": 45,
      "status": "OPERATING"
    }
  ]
}
```

### GET `/landmarks/search` 🔓

**Query:** `?q=uninorte&city=BAQ&limit=10`

**200:** `{ "results": [{ id, name, type, location }] }`

Fuzzy match con `pg_trgm`, tolerante a tildes y typos leves.

### GET `/routes` 🔓

**Query:** `?city=BAQ&mode=TRADITIONAL` (mode opcional)

**200:**
```json
{
  "routes": [
    { "id": "uuid", "code": "C12", "color": "#1E5EFF", "name": "...", "mode": "TRADITIONAL", "operator": "...", "landmarks_count": 8 }
  ]
}
```

### GET `/routes/:id` 🔓

**200:**
```json
{
  "id": "uuid", "code": "C12", "color": "#1E5EFF", "name": "Uninorte - Centro",
  "mode": "TRADITIONAL", "operator": "Coochofal",
  "length_km": 18.4,
  "landmarks": [
    { "id": "uuid", "name": "Uninorte", "fraction_of_corridor": 0.05 },
    { "id": "uuid", "name": "Buenavista", "fraction_of_corridor": 0.42 },
    { "id": "uuid", "name": "Centro", "fraction_of_corridor": 0.92 }
  ],
  "active_buses_count": 4
}
```

### GET `/routes/:id/corridor.geojson` 🔓

Polyline de la ruta lista para `L.geoJSON()` o Mapbox.

**200:**
```json
{
  "type": "Feature",
  "geometry": { "type": "LineString", "coordinates": [[-74.851, 11.018], [-74.849, 11.020], ...] },
  "properties": { "route_id": "uuid", "code": "C12", "color": "#1E5EFF" }
}
```

### GET `/routes/:id/buses` 🔓

Buses activos en la ruta (para animarlos en el mapa).

**200:**
```json
{
  "buses": [
    {
      "id": "uuid", "plate": "URD123",
      "location": { "lat": 11.012, "lng": -74.812 },
      "heading": 245,
      "speed_kmh": 28,
      "fraction_of_corridor": 0.34,
      "last_seen_at": "2026-05-23T14:30:00Z"
    }
  ]
}
```

---

## 4 · Asistente IA conversacional

### POST `/assistant/ask`

Diferenciador #1. Claude Haiku 4.5 con function calling sobre los endpoints reales.

**Request:**
```json
{
  "question": "¿Cómo llego al Centro si voy de afán?",
  "location": { "lat": 11.018, "lng": -74.851 },
  "context": { "current_trip_id": null }
}
```

**200:**
```json
{
  "answer": "Toma la ruta C12 que pasa por aquí en aproximadamente 4 minutos. Te deja en el Centro en 32 minutos. Si quieres una opción más rápida, la B7 está a 8 minutos pero te deja a 3 cuadras del centro.",
  "suggested_action": {
    "type": "START_TRIP",
    "payload": {
      "route_id": "uuid",
      "route_code": "C12",
      "boarding_location": { "lat": 11.018, "lng": -74.851 },
      "dropoff_landmark_id": "uuid",
      "estimated_duration_seconds": 1920
    }
  },
  "latency_ms": 1240
}
```

**Tipos de `suggested_action`:**
- `START_TRIP` — botón "Iniciar viaje"
- `SHOW_ROUTE` — `{ route_id }` → abrir detalle ruta
- `SHOW_LANDMARK` — `{ landmark_id }` → abrir detalle lugar
- `OPEN_WAIT_PIN` — `{ location, route_id }` → crear pin de espera
- `null` — solo respuesta textual, sin acción

### GET `/assistant/messages`

**Query:** `?limit=20`

**200:** `{ "messages": [{ id, question, answer, suggested_action, created_at }] }`

---

## 5 · Viajes y pin de espera

### POST `/wait-sessions`

Pin de espera: el usuario marca un punto y espera notificación WS cuando el bus está cerca.

**Request:**
```json
{
  "location": { "lat": 11.018, "lng": -74.851 },
  "route_id": "uuid",
  "notify_seconds_before": 180
}
```

**201:**
```json
{
  "id": "uuid",
  "location": { ... },
  "route": { "id": "uuid", "code": "C12", "color": "#1E5EFF" },
  "current_next_bus": { "bus_id": "uuid", "eta_seconds": 320 },
  "notify_seconds_before": 180,
  "started_at": "2026-05-23T14:30:00Z"
}
```

Cuando el bus está a ≤180s, llega evento WS `wait_session_alert`. Ver §7.

### DELETE `/wait-sessions/:id`

Cancelar.

### POST `/trips`

**Request:**
```json
{
  "route_id": "uuid",
  "boarding_location": { "lat": 11.018, "lng": -74.851 },
  "dropoff_location": { "lat": 10.984, "lng": -74.795 },
  "boarding_landmark_id": "uuid",
  "dropoff_landmark_id": "uuid"
}
```

**201:**
```json
{
  "id": "uuid",
  "route": { ... },
  "bus": { "id": "uuid", "plate": "URD123", "location": {...} },
  "boarding_location": {...},
  "dropoff_location": {...},
  "started_at": "...",
  "estimated_arrival_at": "...",
  "estimated_duration_seconds": 1920,
  "remaining_landmarks": [
    { "id": "uuid", "name": "Buenavista", "eta_seconds": 540 },
    { "id": "uuid", "name": "Centro", "eta_seconds": 1820 }
  ],
  "status": "IN_PROGRESS"
}
```

### GET `/trips/active`

**200:** `{ "trip": {...} | null }`

### PATCH `/trips/:id`

**Request:** `{ "status": "COMPLETED" | "CANCELLED" }`

### POST `/trips/:id/rating`

**Request:** `{ "stars": 5, "comment": "Bus muy rápido" }`

---

## 6 · Favoritos, incidentes

### POST `/me/favorites`

**Request:** `{ "target_type": "LANDMARK" | "ROUTE", "target_id": "uuid", "alias": "Casa" }`

### DELETE `/me/favorites/:id`

### GET `/me/favorites`

**200:**
```json
{
  "favorites": [
    { "id": "uuid", "target_type": "LANDMARK", "alias": "Casa", "landmark": {...} },
    { "id": "uuid", "target_type": "ROUTE", "alias": "Mi ruta", "route": {...} }
  ]
}
```

### POST `/incidents`

**Request:**
```json
{
  "type": "TRAFFIC" | "FULL_BUS" | "NO_BUS_PASSING" | "ACCIDENT",
  "route_id": "uuid",
  "location": { "lat": 11.018, "lng": -74.851 },
  "description": "Trancón en la 76"
}
```

**201:** `{ "id": "uuid", ... }` → además dispara WS `incident_reported`

### GET `/incidents/nearby` 🔓

**Query:** `?lat&lng&radius_m=1000&since_minutes=60`

**200:** `{ "incidents": [...] }`

---

## 7 · WebSocket realtime

> ⚠️ **CRÍTICO**: el realtime NO es opcional. Los buses se mueven en tiempo real vía WS, no por polling. Conecta el WS desde la primera pantalla. Sin WS la app no se ve viva.

### Conexión

```
wss://api.vialink.app/realtime?token=<jwt>
```

Cliente: `socket.io-client@4`. Sin token funciona también (suscripción anónima a rooms públicos).

### Rooms

Al conectarse, el cliente debe emitir `subscribe`:

```js
socket.emit('subscribe', { room: 'admin' });          // todos los eventos (vista admin)
socket.emit('subscribe', { room: 'city:BAQ' });        // eventos de Barranquilla
socket.emit('subscribe', { room: 'trip:<tripId>' });   // mi viaje activo
socket.emit('subscribe', { room: 'wait:<waitId>' });   // mi pin de espera
```

Para des-suscribirse: `socket.emit('unsubscribe', { room: '...' })`.

### Eventos server → client

#### `agent_action` (solo `admin`)

```json
{
  "type": "agent_action",
  "agentId": "agent_142",
  "agentName": "María",
  "agentProfile": "student_uninorte",
  "action": "asked_ai",
  "payload": { "question": "Cómo llego al Centro" },
  "location": { "lat": 11.005, "lng": -74.806 },
  "timestamp": "2026-05-23T08:14:32Z"
}
```

`action` enum: `walked` | `started_waiting` | `boarded` | `asked_ai` | `started_trip` | `completed_trip` | `rated_trip` | `reported_incident` | `saved_favorite`

#### `bus_position` (rooms `admin`, `city:BAQ`, `bus:<id>`, `trip:<id>`)

```json
{
  "type": "bus_position",
  "busId": "uuid",
  "routeId": "uuid",
  "routeCode": "C12",
  "location": { "lat": 11.012, "lng": -74.812 },
  "heading": 245,
  "speed_kmh": 28,
  "fraction_of_corridor": 0.34,
  "timestamp": "..."
}
```

**Frecuencia**: cada bus emite **cada 1 segundo** (default). Con 80 buses en BAQ son ~80 events/s en room `city:BAQ`.

**⚠️ IMPORTANTE — Interpolación frontend**:

NO renderices saltos discretos entre eventos. El usuario debe ver el bus moviéndose **suavemente**. Patrón recomendado con `framer-motion`:

```tsx
import { motion, useMotionValue, animate } from 'framer-motion';

const busLat = useMotionValue(initialLat);
const busLng = useMotionValue(initialLng);

useEffect(() => {
  socket.on('bus_position', (event) => {
    if (event.busId !== thisBusId) return;
    // Anima de la posición actual a la nueva durante el tick rate
    animate(busLat, event.location.lat, { duration: 1.0, ease: 'linear' });
    animate(busLng, event.location.lng, { duration: 1.0, ease: 'linear' });
  });
}, []);

// Bind busLat, busLng al marcador del mapa
```

Alternativa sin framer-motion: usar `requestAnimationFrame` con interpolación lineal manual.

Sin interpolación, los buses se ven brincando entre posiciones — se nota mal en demo.

#### `trip_update` (room `trip:<tripId>`)

```json
{
  "type": "trip_update",
  "tripId": "uuid",
  "status": "IN_PROGRESS" | "COMPLETED" | "CANCELLED",
  "current_location": {...},
  "remaining_seconds": 1240,
  "next_landmark": { "id": "uuid", "name": "Buenavista", "eta_seconds": 320 }
}
```

#### `wait_session_alert` (room `wait:<waitId>`)

```json
{
  "type": "wait_session_alert",
  "waitSessionId": "uuid",
  "busId": "uuid",
  "routeCode": "C12",
  "eta_seconds": 180,
  "distance_m": 950
}
```

#### `incident_reported` (rooms `admin`, `city:BAQ`)

```json
{
  "type": "incident_reported",
  "incidentId": "uuid",
  "incidentType": "TRAFFIC",
  "routeId": "uuid",
  "location": {...},
  "timestamp": "..."
}
```

#### `metrics_update` (room `admin`)

```json
{
  "type": "metrics_update",
  "metrics": {
    "active_users": 437,
    "active_trips": 89,
    "ai_questions_per_minute": 23,
    "incidents_last_hour": 4,
    "buses_in_service": 142
  }
}
```

Frecuencia: cada 2 segundos.

---

## 8 · Admin (vista del pitch)

### GET `/admin/metrics`

Snapshot puntual de las métricas (alternativa a WS).

### GET `/admin/feed`

**Query:** `?limit=50&since=2026-05-23T14:30:00Z`

**200:** `{ "events": [{ id, agent_id, agent_name, action_type, payload, occurred_at }] }`

### POST `/admin/simulator/start`

**Request:** `{ "agent_count": 500, "speed_multiplier": 1.0 }`

### POST `/admin/simulator/stop`

### GET `/admin/simulator/status`

**200:** `{ "status": "RUNNING" | "STOPPED", "agent_count": 500, "actions_last_minute": 234, "llm_calls_last_minute": 23 }`

---

## 9 · Tabla rápida: pantalla del frontend → endpoints

| Pantalla | Endpoints que consume | Eventos WS |
|---|---|---|
| **1. Mapa principal** | `POST /buses-at-point`, `GET /landmarks/nearby`, `GET /routes/:id/corridor.geojson` (cuando seleccionas ruta), `GET /routes/:id/buses` | `bus_position`, `incident_reported` |
| **2. Detalle de lugar** | `GET /landmarks/:id` | — |
| **3. Asistente IA** | `POST /assistant/ask`, `GET /assistant/messages` | — |
| **4. Viaje activo** | `POST /trips`, `GET /trips/active`, `PATCH /trips/:id`, `POST /trips/:id/rating` | `trip_update`, `bus_position` |
| **5. Vista admin** | `GET /admin/metrics`, `GET /admin/feed`, `POST /admin/simulator/start` | `agent_action`, `metrics_update`, `bus_position`, `incident_reported` |
| (extra) Pin de espera | `POST /wait-sessions`, `DELETE /wait-sessions/:id` | `wait_session_alert` |

---

## 10 · Notas críticas de implementación frontend

### a) Mapa con buses en tiempo real (desde el día 1)
- Suscribirse al WS y room `city:BAQ` apenas se abre la pantalla del mapa
- Cargar buses iniciales con `GET /routes/:id/buses` (snapshot)
- Después, **solo actualizar con eventos WS** — no hacer polling
- Interpolar posiciones para movimiento suave (ver §7, evento `bus_position`)

### b) Pantalla "tap en cualquier punto"
- Cuando usuario tappea, llamar `POST /buses-at-point` (cacheado del lado backend 3s)
- Mostrar bottom sheet con lista de rutas + próximos buses
- Refrescar el bottom sheet cada vez que llegue `bus_position` para una de las rutas mostradas (recalcular ETAs visualmente o pedir snapshot nuevo)

### c) Pin de espera
- Usuario tap "Avísame cuando llegue" → `POST /wait-sessions`
- Suscribirse a room `wait:<id>`
- Notificación visual (toast + sonido suave + vibración móvil) al recibir `wait_session_alert`

### d) Vista admin (pantalla del pitch)
- Suscribirse al room `admin`
- Mantener:
  - Map con todos los buses (`bus_position` continuo)
  - Pinte cada agente como dot cuando llegue `agent_action`, decaer en 5s (queda dot residual visible)
  - Feed scroll automático con últimos 30 eventos `agent_action`
  - Cards de métricas grandes con `metrics_update` (animación de counter cambiando)

### e) Para empezar mientras el backend no está deployado
1. Swagger en `https://[railway-url]/api/docs` cuando esté arriba (~hora 4 del hackatón)
2. Mientras tanto, mockea con MSW usando este documento como contrato
3. Los WS eventos pueden mockearse con un script Node local emitiendo cada 1s:
   ```js
   const io = require('socket.io')(3001);
   setInterval(() => {
     io.emit('bus_position', { busId: '...', location: { lat: 11+Math.random()*0.05, lng: -74.8+Math.random()*0.05 }, ... });
   }, 1000);
   ```

### f) Convenciones de coordenadas
- `{lat, lng}` en TODOS los endpoints REST y eventos WS
- Solo `corridor.geojson` usa el orden GeoJSON `[lng, lat]` (estándar geo)

---

_Última actualización: arranque del hackatón · si encuentras inconsistencia, ping en Slack/WhatsApp._
