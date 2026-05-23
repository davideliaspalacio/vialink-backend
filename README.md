# Vialink Backend

Backend para Vialink — webapp de transporte público inteligente con IA conversacional y simulación de 500 usuarios virtuales.

> **Para el contrato de API que consume el frontend** → ver [`docs/api-contract.md`](./docs/api-contract.md)
> **Para la arquitectura interna** → ver [`docs/architecture.md`](./docs/architecture.md)
> **Para el plan 48h** → ver [`docs/roadmap.md`](./docs/roadmap.md)

---

## Stack

- **NestJS 11** + TypeScript
- **Prisma 6** (ORM)
- **Supabase** (Postgres + PostGIS + Auth)
- **Socket.io** (realtime)
- **Claude Haiku 4.5** (asistente IA)
- **Railway** (deploy)

---

## Setup local

### 1. Requisitos
- Node.js ≥ 20
- pnpm ≥ 10
- Una cuenta de [Supabase](https://supabase.com) (free tier)
- Una API key de [Anthropic](https://console.anthropic.com)
- Una API key de [Mapbox](https://mapbox.com) (free tier, para walking paths del simulador)

### 2. Crear proyecto Supabase

1. Crea un proyecto nuevo en Supabase, región más cercana (recomendado `us-east-1`)
2. En el SQL Editor, habilita PostGIS:
   ```sql
   CREATE EXTENSION IF NOT EXISTS postgis;
   CREATE EXTENSION IF NOT EXISTS pg_trgm;
   CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
   ```
3. Ve a **Project Settings → Database** y copia:
   - **Connection Pooler** (port 6543) → `DATABASE_URL`
   - **Direct Connection** (port 5432) → `DIRECT_URL`
4. Ve a **Project Settings → API** y copia:
   - Project URL → `SUPABASE_URL`
   - `anon` key → `SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY`
   - JWT Secret → `SUPABASE_JWT_SECRET`

### 3. Configurar `.env`

```bash
cp .env.example .env
# editar .env con las credenciales de arriba + Anthropic + Mapbox
```

### 4. Instalar dependencias

```bash
pnpm install
pnpm prisma generate
```

### 5. Aplicar migraciones

```bash
pnpm prisma migrate dev --name init
```

### 6. (Opcional) Seed Barranquilla

```bash
pnpm seed
```

### 7. Correr en dev

```bash
pnpm start:dev
```

- API: http://localhost:3000/api/v1
- Swagger: http://localhost:3000/api/docs
- Health: http://localhost:3000/health

---

## Scripts útiles

| Comando | Qué hace |
|---|---|
| `pnpm start:dev` | Servidor con watch mode |
| `pnpm build` | Compila a `dist/` |
| `pnpm start:prod` | Corre `dist/main.js` |
| `pnpm prisma:generate` | Regenera Prisma client |
| `pnpm prisma:migrate:dev` | Crea/aplica migration en dev |
| `pnpm prisma:migrate:deploy` | Aplica migrations en prod (Railway) |
| `pnpm prisma:studio` | Abre Prisma Studio (GUI DB) |
| `pnpm db:reset` | Reset DB + reseed (¡destructivo!) |
| `pnpm seed` | Solo seed |
| `pnpm smoke` | Smoke test del health endpoint |
| `pnpm lint` | Linter |
| `pnpm format` | Prettier |
| `pnpm test` | Unit tests |

---

## Estructura

```
src/
├── main.ts                  # bootstrap (CORS, Helmet, Swagger, Pino)
├── app.module.ts            # root module
├── config/configuration.ts  # zod validation de envvars
├── common/                  # decorators, filters, dto compartidos
├── prisma/                  # PrismaService global
├── health/                  # /health endpoint
└── [feature modules]/       # auth, routes, landmarks, etc. (en progreso)

prisma/
├── schema.prisma            # schema con PostGIS
├── migrations/              # generadas por Prisma
└── seeds/                   # data inicial de Barranquilla
```

---

## Deploy a Railway

1. Conecta el repo desde el dashboard de Railway
2. Variables de entorno: copia las mismas de `.env`
3. Build command: `pnpm install && pnpm prisma generate && pnpm build`
4. Start command: `pnpm prisma migrate deploy && pnpm start:prod`
5. Healthcheck path: `/health`

---

## Estado del proyecto

- [x] **Bloque 0** · Setup (NestJS + Prisma + Supabase + Swagger + Health)
- [ ] **Bloque 1** · Seed Barranquilla (landmarks + corridors)
- [ ] **Bloque 2** · Discovery APIs (`buses-at-point`, landmarks, routes)
- [ ] **Bloque 3** · Auth + perfil
- [ ] **Bloque 4** · Trips + wait sessions + incidents
- [ ] **Bloque 5** · Asistente Claude con tools
- [ ] **Bloque 6** · Simulador 500 agentes
- [ ] **Bloque 7** · WebSocket + admin
- [ ] **Bloque 8** · Polish + deploy prod
- [ ] **Bloque 9** · Demo prep

Ver [`docs/roadmap.md`](./docs/roadmap.md) para detalle de cada bloque.
