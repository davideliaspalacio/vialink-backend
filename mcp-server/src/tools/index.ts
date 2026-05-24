/**
 * Definición de las tools que el MCP server expone.
 *
 * Cada tool wrappea un endpoint REST del backend Vialink. Sin lógica
 * de negocio extra — el MCP es una "fachada conversacional".
 *
 * Nomenclatura: snake_case en el name (convención MCP) para que clientes
 * tipo Claude Desktop puedan invocarlas fácilmente.
 */

import { z } from 'zod';
import { client } from '../client.js';

// ============================================================
// Schemas reutilizables
// ============================================================

const LatLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const CitySchema = z
  .string()
  .default('BAQ')
  .describe('Código de ciudad. Default BAQ (Barranquilla).');

// ============================================================
// Tier 1 — Core tools
// ============================================================

export const TOOL_LIST_ROUTES = {
  name: 'list_routes',
  description:
    'Lista TODAS las rutas de transporte público activas en la ciudad. Devuelve código, nombre, color, modo (TRADITIONAL/BRT/METRO), operador. Usá esto cuando el user pregunte qué buses hay disponibles.',
  inputSchema: z.object({
    mode: z
      .enum(['TRADITIONAL', 'BRT', 'METRO'])
      .optional()
      .describe('Filtrar por modo de transporte'),
  }),
  handler: async (args: { mode?: 'TRADITIONAL' | 'BRT' | 'METRO' }) => {
    const params: Record<string, string> = {};
    if (args.mode) params.mode = args.mode;
    return client.get('/routes', params);
  },
};

export const TOOL_GET_ROUTE_DETAIL = {
  name: 'get_route_detail',
  description:
    'Detalles completos de una ruta específica por su ID UUID. Incluye paraderos en orden, length, operador, etc.',
  inputSchema: z.object({
    route_id: z.string().uuid().describe('UUID de la ruta'),
  }),
  handler: async (args: { route_id: string }) =>
    client.get(`/routes/${args.route_id}`),
};

export const TOOL_GET_ROUTE_CORRIDOR = {
  name: 'get_route_corridor',
  description:
    'Polyline GeoJSON del corridor (recorrido completo) de una ruta. Útil para visualizaciones o cálculos espaciales.',
  inputSchema: z.object({
    route_id: z.string().uuid(),
  }),
  handler: async (args: { route_id: string }) =>
    client.get(`/routes/${args.route_id}/corridor.geojson`),
};

export const TOOL_GET_BUSES_ON_ROUTE = {
  name: 'get_buses_on_route',
  description:
    'Lista todos los buses IN_SERVICE actualmente operando en una ruta específica, con su posición, velocidad y fracción del corridor recorrida.',
  inputSchema: z.object({
    route_id: z.string().uuid(),
  }),
  handler: async (args: { route_id: string }) =>
    client.get(`/routes/${args.route_id}/buses`),
};

export const TOOL_LIST_ALL_ACTIVE_BUSES = {
  name: 'list_all_active_buses',
  description:
    'Snapshot de TODOS los buses IN_SERVICE en la ciudad. Útil para análisis globales: cuántos buses están activos, distribución por ruta, etc. Para Barranquilla típicamente hay ~34 buses.',
  inputSchema: z.object({
    city: CitySchema,
  }),
  handler: async (args: { city: string }) =>
    client.get('/buses', { city: args.city }),
};

export const TOOL_GET_BUS_DETAIL = {
  name: 'get_bus_detail',
  description:
    'Información detallada y EN VIVO de un bus específico: velocidad actual, próximo paradero con ETA, progreso del recorrido, polyline del corridor. Si pasás user_location, también devuelve ETA al usuario.',
  inputSchema: z.object({
    bus_id: z.string().uuid(),
    user_location: LatLngSchema.optional().describe(
      'Ubicación del usuario para calcular ETA del bus al usuario',
    ),
  }),
  handler: async (args: {
    bus_id: string;
    user_location?: { lat: number; lng: number };
  }) => {
    const query: Record<string, string> = {};
    if (args.user_location) {
      query.lat = String(args.user_location.lat);
      query.lng = String(args.user_location.lng);
    }
    return client.get(`/buses/${args.bus_id}/details`, query);
  },
};

export const TOOL_FIND_LANDMARKS_NEAR = {
  name: 'find_landmarks_near',
  description:
    'Paraderos y lugares de interés (universidades, malls, hospitales, etc.) cerca de una coordenada. Útil para "qué hay cerca de aquí".',
  inputSchema: z.object({
    location: LatLngSchema,
    radius_m: z
      .number()
      .int()
      .min(50)
      .max(5000)
      .default(1500)
      .describe('Radio de búsqueda en metros'),
  }),
  handler: async (args: {
    location: { lat: number; lng: number };
    radius_m: number;
  }) =>
    client.get('/landmarks/nearby', {
      lat: args.location.lat,
      lng: args.location.lng,
      radius_m: args.radius_m,
    }),
};

export const TOOL_SEARCH_LANDMARKS = {
  name: 'search_landmarks',
  description:
    'Busca paraderos/lugares por nombre. Útil para encontrar "Buenavista", "Universidad del Norte", "Plaza de la Paz", etc.',
  inputSchema: z.object({
    query: z.string().min(2),
    limit: z.number().int().min(1).max(20).default(10),
  }),
  handler: async (args: { query: string; limit: number }) =>
    client.get('/landmarks/search', { q: args.query, limit: args.limit }),
};

export const TOOL_FIND_ROUTES_NEAR = {
  name: 'find_routes_near',
  description:
    'Rutas de bus que pasan cerca de una coordenada. Útil para "qué buses pasan por aquí". Devuelve solo info de rutas, sin los buses específicos.',
  inputSchema: z.object({
    location: LatLngSchema,
    radius_m: z.number().int().min(50).max(2000).default(100),
  }),
  handler: async (args: {
    location: { lat: number; lng: number };
    radius_m: number;
  }) =>
    client.get('/routes/nearby', {
      lat: args.location.lat,
      lng: args.location.lng,
      radius_m: args.radius_m,
    }),
};

export const TOOL_BUSES_AT_POINT = {
  name: 'buses_at_point',
  description:
    'Rutas Y buses específicos próximos a una coordenada, con ETAs. Más completo que find_routes_near.',
  inputSchema: z.object({
    location: LatLngSchema,
    radius_m: z.number().int().min(10).max(500).default(100),
  }),
  handler: async (args: {
    location: { lat: number; lng: number };
    radius_m: number;
  }) =>
    client.post('/buses-at-point', {
      location: args.location,
      radius_m: args.radius_m,
    }),
};

export const TOOL_BUSES_AT_ADDRESS = {
  name: 'buses_at_address',
  description:
    'Geocodifica una dirección (e.g. "Cra 53 con Cl 84") y devuelve los buses que pasan por ahí. Combina geocoding + buses-at-point.',
  inputSchema: z.object({
    address: z
      .string()
      .min(2)
      .max(120)
      .describe('Dirección libre, formato colombiano OK ("Cra 50 con Cl 84")'),
    user_location: LatLngSchema.optional().describe(
      'Sesga el geocoding hacia la ubicación del usuario',
    ),
    radius_m: z.number().int().min(10).max(500).default(100),
    city: CitySchema,
  }),
  handler: async (args: {
    address: string;
    user_location?: { lat: number; lng: number };
    radius_m: number;
    city: string;
  }) =>
    client.post('/buses-at-address', {
      address: args.address,
      user_location: args.user_location,
      radius_m: args.radius_m,
      city: args.city,
    }),
};

export const TOOL_RECOMMEND_ROUTE = {
  name: 'recommend_route',
  description:
    'EL TOOL ESTRELLA. Recomienda la mejor ruta puerta-a-puerta en bus entre 2 puntos. Devuelve top N opciones rankeadas por tiempo total. Cada opción incluye: paradero de abordaje + cuántas cuadras camina, bus específico (id, plate, ruta) + espera y tiempo de viaje, paradero de descenso + cuadras al destino, polyline del bus.',
  inputSchema: z.object({
    user_location: LatLngSchema.describe('Ubicación actual del usuario'),
    destination: LatLngSchema.describe('Punto al que quiere llegar'),
    max_walking_m: z
      .number()
      .int()
      .min(100)
      .max(2000)
      .default(500)
      .describe('Distancia máxima de caminata aceptable (500m = 5 cuadras)'),
    max_alternatives: z.number().int().min(1).max(5).default(3),
  }),
  handler: async (args: {
    user_location: { lat: number; lng: number };
    destination: { lat: number; lng: number };
    max_walking_m: number;
    max_alternatives: number;
  }) =>
    client.post('/routing/recommend', {
      user_location: args.user_location,
      destination: args.destination,
      max_walking_m: args.max_walking_m,
      max_alternatives: args.max_alternatives,
    }),
};

export const TOOL_WALKING_DIRECTIONS = {
  name: 'walking_directions',
  description:
    'Ruta de caminata real entre 2 puntos siguiendo calles (Mapbox Walking). Devuelve polyline + distance_m + duration_seconds.',
  inputSchema: z.object({
    from: LatLngSchema,
    to: LatLngSchema,
  }),
  handler: async (args: {
    from: { lat: number; lng: number };
    to: { lat: number; lng: number };
  }) => client.post('/routing/walk', { from: args.from, to: args.to }),
};

// ============================================================
// Tier 2 — Admin/debug
// ============================================================

export const TOOL_GET_ENGINE_STATUS = {
  name: 'get_engine_status',
  description:
    'Estado del BusEngine: si está corriendo, tickMs, cuántos ticks procesados, cuántos buses movidos. Diagnóstico.',
  inputSchema: z.object({}),
  handler: async () => client.get('/buses/engine/status'),
};

export const TOOL_GET_SYSTEM_METRICS = {
  name: 'get_system_metrics',
  description:
    'Métricas del sistema: usuarios activos, viajes activos, preguntas/min al AI, incidentes última hora, buses en servicio.',
  inputSchema: z.object({}),
  handler: async () => client.get('/admin/metrics'),
};

export const TOOL_GET_SIMULATOR_STATUS = {
  name: 'get_simulator_status',
  description:
    'Estado del simulador de 500 agentes: si está corriendo, agentes activos, perfiles, acciones/min.',
  inputSchema: z.object({}),
  handler: async () => client.get('/admin/simulator/status'),
};

// ============================================================
// Export todas las tools
// ============================================================

export const ALL_TOOLS = [
  TOOL_LIST_ROUTES,
  TOOL_GET_ROUTE_DETAIL,
  TOOL_GET_ROUTE_CORRIDOR,
  TOOL_GET_BUSES_ON_ROUTE,
  TOOL_LIST_ALL_ACTIVE_BUSES,
  TOOL_GET_BUS_DETAIL,
  TOOL_FIND_LANDMARKS_NEAR,
  TOOL_SEARCH_LANDMARKS,
  TOOL_FIND_ROUTES_NEAR,
  TOOL_BUSES_AT_POINT,
  TOOL_BUSES_AT_ADDRESS,
  TOOL_RECOMMEND_ROUTE,
  TOOL_WALKING_DIRECTIONS,
  TOOL_GET_ENGINE_STATUS,
  TOOL_GET_SYSTEM_METRICS,
  TOOL_GET_SIMULATOR_STATUS,
] as const;

export type Tool = (typeof ALL_TOOLS)[number];
