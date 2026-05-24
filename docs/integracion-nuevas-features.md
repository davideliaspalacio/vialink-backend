# Vialink — Nuevas features para integrar en el frontend

> **Para:** Sebastián (Frontend Lead) + su agente IA (Cursor/Claude/Copilot)
> **De:** David Palacio (Backend)
> **Sesión:** 23 May 2026
>
> Resumen autocontenido de todo lo nuevo que el backend expone. Pásalo
> tal cual a tu agente IA o léelo tú mismo en 5 minutos.

---

## TL;DR — qué cambió en el backend

| Nuevo | Para qué sirve |
|---|---|
| `GET /api/v1/geocode` | Convierte direcciones libres ("Calle 84 con Cra 50") a coords |
| `POST /api/v1/buses-at-address` | Geocode + buses-at-point en una sola llamada |
| `GET /api/v1/buses/:id/details` | Modal "click en bus": info + ruta completa + ETA |
| **Asistente Claude más inteligente** | Ahora entiende direcciones libres, no solo lugares conocidos |
| **Corridors siguen calles reales** | Los buses ya no atraviesan edificios — siguen el polyline real de Barranquilla (cambio en DB, sin redeploy) |

⚠️ **Estado deployment:**
- 86 buses ya se mueven por calles reales (DB ya actualizada)
- Los 3 endpoints REST nuevos están **solo en local**, no en Railway aún
- Cuando David pushee, Railway redeploya automático

📍 **URL backend prod:** https://vialink-backend-production.up.railway.app
📚 **Swagger interactivo (cuando se haga deploy):** https://vialink-backend-production.up.railway.app/api/docs

---

## 1. `GET /api/v1/geocode` — buscador de direcciones

### Caso de uso

El usuario escribe en el buscador del mapa "Calle 84 con Cra 50" y debe
ver sugerencias en tiempo real para seleccionar.

### Contrato

```
GET /api/v1/geocode?q=<texto>&lat=<num>&lng=<num>&limit=<int>
```

- **Auth:** ❌ Endpoint público
- `q` (string, 2-120 chars, **required**)
- `lat`, `lng` (float, opcional) — ubicación del usuario para sesgar resultados
- `limit` (int, default 5, max 10)

### Response 200

```json
{
  "query": "Calle 84 con Cra 50",
  "results": [
    {
      "formatted_address": "Carrera 50 84 197, 080020 Barranquilla, Atlántico, Colombia",
      "location": { "lat": 11.0047, "lng": -74.8198 },
      "category": "address",
      "relevance": 0.8,
      "source": "mapbox" | "cache"
    }
  ],
  "cached": false,
  "latency_ms": 380
}
```

### Errores

| Status | Cuándo | Frontend |
|---|---|---|
| `400` | query vacía o malformada | mostrar error genérico |
| `502` | Mapbox falló | mostrar "Sin resultados" (graceful) |
| `503` | Token Mapbox no configurado en backend | mostrar "Sin resultados" (graceful) |

### Calidad esperada

| Tipo de query | ¿Funciona? |
|---|---|
| Direcciones formales (`Calle X con Cra Y`, `Cra X #N-M`) | ✅ Sí |
| Direcciones con #, abreviaturas (`Cra`, `Cl`, `Av`) | ✅ El backend normaliza automático |
| Avenidas con nombre (`Av Olaya Herrera`) | ⚠️ A veces (Mapbox no indexa todas) |
| POIs (`Uninorte`, `Estadio Metropolitano`) | ❌ Para esto usa `GET /landmarks/search?q=` que ya existe |

### Recomendación de UX

Combina **dos hooks en el buscador**:
1. `useLandmarkSearch(q)` → busca en los 80 landmarks pre-cargados
2. `useGeocode(q, userLocation)` → busca direcciones libres

Renderiza ambos en el mismo dropdown, priorizando landmarks arriba.

---

## 2. `POST /api/v1/buses-at-address` — endpoint combinado

### Caso de uso

Cuando el usuario selecciona una dirección del buscador, en lugar de hacer
2 llamadas (geocode → buses-at-point), una sola llamada hace todo.

### Contrato

```
POST /api/v1/buses-at-address
Content-Type: application/json
```

- **Auth:** ❌ Público

**Body:**
```json
{
  "address": "Calle 84 con Cra 50",
  "user_location": { "lat": 11.0186, "lng": -74.8499 },
  "radius_m": 100,
  "city": "BAQ"
}
```

`user_location`, `radius_m`, `city` son opcionales.

### Response 200

```json
{
  "destination": {
    "query": "Calle 84 con Cra 50",
    "formatted_address": "Carrera 50 84 197, 080020 Barranquilla, ...",
    "location": { "lat": 11.0047, "lng": -74.8198 }
  },
  "routes": [
    {
      "route": { "id", "code", "name", "color", "mode", "operator" },
      "distance_to_corridor_m": 12,
      "next_buses": [
        {
          "bus_id": "uuid",
          "plate": "URD123",
          "eta_seconds": 240,
          "distance_m": 800,
          "current_location": { "lat": 11.01, "lng": -74.85 }
        }
      ],
      "status": "OPERATING" | "LOW_FREQUENCY" | "OFFLINE"
    }
  ]
}
```

Misma shape que `POST /buses-at-point` pero con `destination` extra.

### Errores

| Status | Cuándo |
|---|---|
| `400` | address vacía o body malformado |
| `404` | Mapbox no encontró la dirección |
| `502` / `503` | Geocoding upstream falla |

---

## 3. `GET /api/v1/buses/:id/details` — modal click-on-bus

### Caso de uso

Cuando el usuario tap en un `BusMarker` del mapa, abrir un sheet/modal
con info completa + dibujar el polyline de la ruta + mostrar ETA al
usuario si tiene ubicación.

### Contrato

```
GET /api/v1/buses/:id/details?lat=<float>&lng=<float>
```

- **Auth:** ❌ Público
- `:id` (UUID, path, **required**) — el `bus.id` que viene en `BusPosition` events
- `lat`, `lng` (float, query, opcional) — si presentes, response incluye `eta_to_user`

### Response 200

```json
{
  "bus": {
    "id": "uuid",
    "plate": "URD123",
    "location": { "lat": 11.012, "lng": -74.812 },
    "heading": 245,
    "speed_kmh": 28,
    "fraction_of_corridor": 0.34,
    "status": "IN_SERVICE",
    "last_seen_at": "2026-05-23T20:34:13Z"
  },
  "route": {
    "id": "uuid",
    "code": "C12",
    "name": "Centro - Uninorte",
    "color": "#1E5EFF",
    "mode": "TRADITIONAL",
    "operator": "Coochofal",
    "length_km": 17.65
  },
  "polyline": {
    "type": "Feature",
    "geometry": {
      "type": "LineString",
      "coordinates": [[-74.78, 10.96], [-74.79, 10.97], ...]
    },
    "properties": { "route_id": "...", "code": "C12", "color": "#1E5EFF" }
  },
  "next_landmark": {
    "id": "uuid",
    "name": "Universidad del Norte",
    "type": "UNIVERSITY",
    "location": { "lat": 11.018, "lng": -74.851 },
    "eta_seconds": 240,
    "distance_m": 1200
  },
  "eta_to_user": {
    "eta_seconds": 320,
    "distance_m": 1500,
    "nearest_corridor_point": { "lat": 11.015, "lng": -74.849 }
  },
  "stats": {
    "completed_km": 6.0,
    "completed_pct": 0.34,
    "remaining_km": 11.65
  }
}
```

**Campos siempre presentes:** `bus`, `route`, `polyline`, `stats`
**Condicionales:**
- `next_landmark` → puede ser `null` si el bus está al final del recorrido
- `eta_to_user` → solo si pasas `lat`+`lng` Y el bus aún no pasó por el usuario

### Errores

| Status | Cuándo | Frontend |
|---|---|---|
| `400` | UUID inválido en path | toast error |
| `404` | Bus no existe | cerrar modal, toast "Bus no disponible" |
| `410` | Bus completó recorrido / OUT_OF_SERVICE | mostrar "Bus completó su recorrido" en modal + deshabilitar acciones |

### Cache

Backend cachea 1s TTL (key = `busId:lat:lng`). Si haces el mismo request
2 veces seguidas, la segunda es instantánea.

### Notas técnicas

- **Polyline tiene 100-900 puntos** (siguen calles reales tras snap-to-roads)
- **Latencia esperada:** <100ms en producción
- **GeoJSON coords** vienen en orden `[lng, lat]` (estándar). Convierte
  a `[lat, lng]` para Leaflet con `.map(([lng, lat]) => [lat, lng])`

---

## 4. Asistente Claude — ahora entiende direcciones libres

**Sin cambios en el contrato.** El endpoint `POST /api/v1/assistant/ask`
sigue funcionando igual.

Lo nuevo: internamente Claude tiene una tool `geocode_address` que usa
cuando el usuario menciona una dirección formal (vs. un landmark conocido).

### Ejemplo de mejora

**Pregunta:** *"¿Cómo llego desde Uninorte hasta la Calle 84 con Cra 50?"*

**Antes:**
> *"No puedo ubicar exactamente la Calle 84 con Cra 50 en el sistema."*

**Ahora:**
> *"La mejor opción es el bus **U7 (Universidades)**. El viaje toma
> aproximadamente **17 minutos** en total (4 esperando + 10 en el bus).
> Te recomiendo bajarte cuando veas la Calle 84 con Carrera 50."*

Con `suggested_action: OPEN_WAIT_PIN` en la ubicación del usuario.

**Para el frontend:** ningún cambio. Tu integración del asistente sigue
funcionando, solo notarás respuestas más útiles.

---

## 5. Corridors reales (cambio en DB, transparente al frontend)

Antes los corridors de las 16 rutas tenían 6-11 puntos en línea recta
entre waypoints, lo que hacía que los buses "atravesaran" edificios.

**Ahora:**
- Cada corridor tiene 100-900 puntos siguiendo calles reales (Mapbox
  Directions API)
- Total: 7,402 puntos vs los 110 originales (67x más detalle)
- Las distancias reflejan ahora la longitud real de calles
  (ej. C12: 11 km → 17.65 km)

**Para el frontend:**
- `GET /routes/:id/corridor.geojson` ahora devuelve un polyline más
  fluido — se ve perfecto en el mapa sin cambios de código
- Los buses (vía WS `bus_position`) están sobre calles reales
- ETAs calculados con distancia real (más confiables)

---

## 📋 Orden recomendado de implementación

Para tu agente IA. Cada paso es un commit, con tests primero (TDD).

### Sprint 1 — Endpoint /geocode + buscador

1. Agregar `BackendGeocodeResponse` a `src/types/backend.ts`
2. Agregar `GeocodeSuggestion` a `src/types/index.ts`
3. Mapper `backendGeocodeResultToSuggestion` en `src/lib/mappers.ts` + test
4. Método `dataSource.geocode()` con branch USE_MOCKS
5. Hook `src/hooks/useGeocode.ts` con debounce 350ms
6. Componente `src/components/ui/AddressSearchBar.tsx`
7. MSW handler para `/geocode`
8. Integrar en `MapaPage.tsx` encima del mapa

📖 **Detalle completo + código copy-paste:**
[`docs/frontend-implementation.md`](./frontend-implementation.md) **sección 12**

### Sprint 2 — Endpoint /buses/:id/details + modal

1. Agregar `BackendBusDetailsResponse` a `src/types/backend.ts`
2. Agregar `BusDetails` a `src/types/index.ts`
3. Mapper `backendBusDetailsToBusDetails` en `src/lib/mappers.ts` + test
4. Método `dataSource.getBusDetails()` con branch USE_MOCKS
5. Hook `src/hooks/useBusDetails.ts`
6. Componente `src/components/map/BusDetailSheet.tsx`
7. Integrar en `MapaPage.tsx`:
   - State `selectedBusId`
   - `<Polyline>` cuando hay bus seleccionado
   - Subscribe a `bus:<id>` por WS
8. MSW handler para `/buses/:id/details`

📖 **Detalle completo + código copy-paste:**
[`docs/frontend-implementation.md`](./frontend-implementation.md) **sección 13.1 - 13.10**

### Sprint 3 — Animaciones para el pitch (🎬 polish)

Estas son las **7 mejoras visuales** que hacen la demo cinematográfica.
Implementar en orden de impacto:

| # | Mejora | Esfuerzo | Impacto |
|---|---|---|---|
| 1 | **EtaCountdown** en vivo ⭐ | 45 min | 🔥🔥🔥🔥 |
| 2 | AnimatedRoutePolyline (dibujo progresivo) | 1h | 🔥🔥🔥 |
| 3 | Bus seleccionado destacado (halo pulsante) | 20 min | 🔥🔥🔥 |
| 4 | AvisameButton transformándose en check | 30 min | 🔥🔥 |
| 5 | Spring physics al abrir BottomSheet | 5 min | 🔥🔥 |
| 6 | Bus rotado según heading | 10 min | 🔥 |
| 7 | Trail detrás del bus (opcional) | 1h | 🔥 |

📖 **Detalle completo + código copy-paste:**
[`docs/frontend-implementation.md`](./frontend-implementation.md) **sección 13.11**

---

## 🤖 Prompt listo para tu agente IA

Copia desde `>>>` hasta `<<<` y pégaselo al inicio de la sesión con tu agente:

```
>>>

Estoy integrando 3 features nuevas del backend de Vialink al frontend:

1. Buscador de direcciones (GET /geocode) — el usuario escribe libre y ve sugerencias
2. Modal "click en bus" (GET /buses/:id/details) — info completa + polyline + ETA
3. 7 animaciones para que el pitch se vea cinematográfico

El backend está en https://vialink-backend-production.up.railway.app
Los 3 endpoints son @Public (no requieren auth).

Documentación técnica completa con código copy-paste TDD:
  docs/frontend-implementation.md
    - Sección 12: buscador de direcciones
    - Sección 13: modal click-on-bus
    - Sección 13.11: animaciones para el pitch

Stack del frontend (NO cambiar):
  React 19 + Vite + TypeScript + Tailwind + Zustand + TanStack Query 5 +
  socket.io-client + Leaflet + Framer Motion

Reglas inviolables:
  1. NO reescribir src/lib/api.ts (HTTP client production-grade)
  2. NO reescribir src/hooks/useRealtime.ts (WS singleton con rooms)
  3. NO reescribir src/lib/dataSource.ts — solo EXTENDER con nuevos métodos
  4. Todo dato del backend pasa por mappers en src/lib/mappers.ts antes de tocar componentes
  5. TDD: test rojo → código verde → refactor
  6. Mobile-first 393px (iPhone)
  7. Coordenadas siempre {lat, lng} — nunca [lng, lat] excepto en GeoJSON

Orden de trabajo:
  Sprint 1: implementa la sección 12 (geocoding + buscador)
  Sprint 2: implementa la sección 13 (modal click-on-bus)
  Sprint 3: implementa la sección 13.11 (animaciones del pitch)

Después de cada paso de cada sprint:
  - Corre `pnpm test` y confirma verde
  - Verifica visualmente en `pnpm dev` con responsive 393px
  - Commit con mensaje feat(<scope>): <descripción>

Cuando termines TODO, dime "listo" y muestra:
  - Lista de archivos creados/modificados
  - Resultado final de pnpm test (todos verdes)
  - Cualquier ajuste necesario al doc

Empieza por: implementa el setup de Vitest si aún no está, después
arranca con el Sprint 1.

<<<
```

---

## ❓ Preguntas frecuentes

**¿Tengo que cambiar mi configuración de `.env`?**
No. Las URLs `VITE_API_URL` y `VITE_WS_URL` siguen igual. Los endpoints
nuevos están bajo `/api/v1` como los demás.

**¿Cuándo se hace deploy a producción?**
David hace push cuando esté listo. Mientras tanto, los endpoints nuevos
están solo en local. **Excepción:** los corridors mejorados (snap-to-roads)
YA están en producción porque la DB se comparte entre local y Railway.

**¿Qué pasa si llamo `/geocode` y devuelve 503?**
Significa que el `MAPBOX_ACCESS_TOKEN` no está configurado en Railway
todavía. El frontend debe manejarlo silenciosamente (mostrar dropdown
vacío o "Sin resultados") sin romper la UX.

**¿El asistente Claude requiere algún cambio en mi código?**
No. Sigue llamando `POST /assistant/ask` igual. Solo notarás que ahora
da respuestas mejores cuando el usuario menciona direcciones formales.

**¿Por qué algunos buses tienen polylines de 500+ puntos y eso es pesado?**
Leaflet maneja eso sin problema. Si en algún device se ve laggy, usa
`<Polyline renderer={L.canvas()}>` en vez de SVG.

**¿Cómo me suscribo al WS room de un bus específico?**
`socket.emit('subscribe', { room: 'bus:<busId>' })` cuando abres el modal.
Cuando lo cierras: `socket.emit('unsubscribe', { room: 'bus:<busId>' })`.
Tu hook `useRealtime` ya lo soporta.

---

## 🔗 Links útiles

- **Backend repo:** https://github.com/davideliaspalacio/vialink-backend
- **API prod:** https://vialink-backend-production.up.railway.app
- **Swagger:** https://vialink-backend-production.up.railway.app/api/docs
- **Doc técnico completo (este es el resumen):** [`frontend-implementation.md`](./frontend-implementation.md)
- **PDF para humanos (no para agentes IA):** [`Vialink-Frontend-Guide.pdf`](./Vialink-Frontend-Guide.pdf)
- **Contrato API completo:** [`api-contract.md`](./api-contract.md)

---

## 📞 Contacto

Cualquier inconsistencia entre este doc y el backend → ping David.
Probablemente el backend tenga el comportamiento correcto y este doc
necesite actualizarse.

— David Palacio · Backend Lead Vialink
