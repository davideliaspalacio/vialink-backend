# Vialink MCP Server

MCP (Model Context Protocol) server que expone los datos del transporte
público de Barranquilla como tools que cualquier cliente MCP puede
invocar con lenguaje natural.

**Casos de uso:**

- En **Claude Desktop**: "¿Cuántos buses tiene la ruta C12 ahora?"
- En **Claude Code**: "Muéstrame todas las rutas activas en la ciudad"
- En **agentes propios**: integrar Vialink en cualquier app con MCP

---

## 🚀 Quickstart local

```bash
cd mcp-server
pnpm install
pnpm build
```

### Conectar a Claude Desktop

Abrí (creá si no existe) `~/Library/Application Support/Claude/claude_desktop_config.json`
y agregá:

```json
{
  "mcpServers": {
    "vialink": {
      "command": "node",
      "args": [
        "/Users/1234/hackaton2026/vialing-backend/mcp-server/dist/server.js"
      ],
      "env": {
        "VIALINK_API_URL": "http://localhost:3000"
      }
    }
  }
}
```

Reiniciá Claude Desktop. En el chat deberías ver el icon 🛠️ indicando
tools disponibles del MCP `vialink`.

Si lo querés correr contra el backend en **Railway prod** en vez de
local, cambiá la env var:

```json
"env": {
  "VIALINK_API_URL": "https://vialink-backend-production.up.railway.app"
}
```

### Conectar a Claude Code

Agregá en `~/.claude.json` o el archivo de proyecto:

```json
{
  "mcpServers": {
    "vialink": {
      "command": "node",
      "args": ["/ruta/absoluta/al/mcp-server/dist/server.js"],
      "env": {
        "VIALINK_API_URL": "http://localhost:3000"
      }
    }
  }
}
```

---

## 🧰 Tools disponibles (16 total)

### Tier 1 — Core (13 tools)

| # | Tool | Descripción |
|---|---|---|
| 1 | `list_routes` | Lista todas las rutas activas (con filtro opcional por modo) |
| 2 | `get_route_detail` | Detalle de una ruta por UUID |
| 3 | `get_route_corridor` | Polyline GeoJSON del recorrido de una ruta |
| 4 | `get_buses_on_route` | Buses en servicio sobre una ruta específica |
| 5 | `list_all_active_buses` | Snapshot de TODOS los buses en servicio (~34 en Barranquilla) |
| 6 | `get_bus_detail` | Datos en vivo de un bus: velocidad, próximo paradero, ETA |
| 7 | `find_landmarks_near` | Paraderos/lugares cerca de una coordenada |
| 8 | `search_landmarks` | Buscar paraderos por nombre |
| 9 | `find_routes_near` | Rutas que pasan cerca de una coordenada |
| 10 | `buses_at_point` | Rutas + buses específicos próximos a una coord |
| 11 | `buses_at_address` | Geocodifica dirección + buses cerca (en una llamada) |
| 12 | `recommend_route` ⭐ | Mejor ruta puerta-a-puerta entre 2 puntos |
| 13 | `walking_directions` | Polyline de caminata real entre 2 puntos |

### Tier 2 — Admin/debug (3 tools)

| # | Tool | Descripción |
|---|---|---|
| 14 | `get_engine_status` | Estado del BusEngine (tick, ticks procesados) |
| 15 | `get_system_metrics` | Métricas live: usuarios, viajes, AI calls, buses |
| 16 | `get_simulator_status` | Estado del simulador de 500 agentes |

---

## 💬 Prompts de demo

Una vez conectado a Claude Desktop:

```
"¿Qué rutas de bus hay en Barranquilla?"
→ usa list_routes
```

```
"¿Cuántos buses están operando ahora mismo?"
→ usa list_all_active_buses
```

```
"Si estoy en (lat 11.0186, lng -74.8499) y quiero ir a Buenavista,
 ¿cuál es la mejor ruta?"
→ usa search_landmarks → recommend_route
```

```
"Dame los detalles del bus con plate JOK516"
→ usa list_all_active_buses → get_bus_detail
```

```
"¿Qué paraderos hay cerca de Plaza de la Paz?"
→ usa search_landmarks → find_landmarks_near
```

```
"¿Qué buses pasan por Cra 53 con Cl 84?"
→ usa buses_at_address
```

---

## 🏗️ Arquitectura

```
┌─────────────────┐     stdio      ┌──────────────┐     HTTP       ┌─────────────┐
│ Claude Desktop  │ ─────────────► │  MCP Server  │ ─────────────► │  Vialink    │
│  (or any MCP    │ ◄───────────── │  (este pkg)  │ ◄───────────── │  backend    │
│   client)       │   tool calls   │              │   REST JSON    │  NestJS     │
└─────────────────┘                └──────────────┘                └─────────────┘
                                                                       │
                                                                       ▼
                                                                  ┌─────────┐
                                                                  │ Supabase│
                                                                  │PostGIS  │
                                                                  └─────────┘
```

**Por qué wrap el backend en vez de acceder a la DB directamente:**

- ✅ Reusa la lógica de PostGIS + caché + validaciones que ya está en NestJS
- ✅ Si cambia algo del backend (nuevo endpoint, ETA calc, etc.) el MCP lo hereda
- ✅ El backend ya está deployado y monitoreado en Railway
- ✅ El MCP queda agnostic del schema de DB

---

## 🌐 Deployment

### Opción A: Local stdio (default para Claude Desktop)

Build local + path absoluto en config. Cero costo, cero deploy.

### Opción B: HTTP en Railway (production-ready)

El server soporta Streamable HTTP transport (MCP spec 2024-11-05+).
Modo stateless: cada request crea su propia instancia, escala horizontal
sin pegamento.

**Setup en Railway:**

1. En el dashboard del proyecto Vialink, click **"+ New"** → **"GitHub Repo"**
   → seleccionar `vialink-backend` (el mismo repo del backend).

2. En el servicio nuevo, ir a **Settings**:

   | Setting | Valor |
   |---|---|
   | **Root Directory** | `mcp-server` |
   | **Branch** | `main` |
   | **Build Command** | `pnpm install --frozen-lockfile && pnpm build` |
   | **Start Command** | `node dist/server.js --http` |
   | **Watch Paths** | `mcp-server/**` |
   | **Healthcheck Path** | `/health` |

3. **Variables** del servicio:

   ```
   VIALINK_API_URL=https://vialink-backend-production.up.railway.app
   ```

   (Railway setea `PORT` automáticamente; el código ya lo respeta)

4. **Settings → Networking → Generate Domain** para tener una URL pública
   tipo `vialink-mcp-production.up.railway.app`.

5. Verificar deploy: `curl https://<tu-mcp-url>/health` debe responder
   `{ ok: true, tools: 16, ... }`.

**Endpoints expuestos:**

| Method | Path | Descripción |
|---|---|---|
| GET | `/health` | Healthcheck (Railway lo usa para deciding healthy/unhealthy) |
| GET | `/` | Redirect a `/health` |
| POST | `/mcp` | Endpoint MCP principal (Streamable HTTP) |

**Conectar Claude Desktop al MCP deployed:**

En `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "vialink-prod": {
      "url": "https://<tu-mcp-url>/mcp"
    }
  }
}
```

(Claude Desktop ≥ 0.10 soporta transport HTTP. Versiones más viejas solo
soportan stdio.)

**Costo estimado en Railway**: ~$2-3/mes en idle. Cada request consume
poco CPU (es un thin wrapper sobre fetch al backend). Free tier alcanza
si el demo es esporádico.

### Opción C: Cloudflare Workers

Para deploy gratis 100% se podría portar a Workers, pero requiere
adaptar el código para usar `fetch` API en vez de Express. ~2-3h de
trabajo. Opcional.

---

## 🛠️ Desarrollo

```bash
# Watch mode (re-builds on save)
pnpm dev

# Build prod
pnpm build

# Manual test (sin Claude Desktop)
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node dist/server.js
```

---

## 📝 Variables de entorno

| Var | Default | Descripción |
|---|---|---|
| `VIALINK_API_URL` | `http://localhost:3000` | URL base del backend Vialink (sin trailing slash) |
| `PORT` | `3333` | Puerto HTTP (solo modo `--http`) |

---

## 🔒 Consideraciones de seguridad

Las tools son **READ-ONLY** — no exponen escrituras (no hay tool de
"crear viaje", "reportar incidente", etc). Esto es intencional: el
MCP está pensado para consulta de datos, no para mutación.

Si en algún momento se quiere agregar tools de mutación (e.g.
`report_incident`), considerá:

- Autenticación en el backend (los endpoints `/incidents`, `/trips` ya
  requieren JWT)
- Rate limiting
- Audit log de quién (qué cliente MCP) hizo qué
