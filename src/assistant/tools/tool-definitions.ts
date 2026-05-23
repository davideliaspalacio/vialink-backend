/**
 * Vialink Assistant — tool definitions for Claude function calling.
 *
 * These are passed to Claude via the `tools` parameter on each ask().
 * Each tool's schema is JSON Schema for the inputs. The handler implementation
 * lives in `assistant-tools.service.ts`.
 *
 * Keep tools small, well-named, and well-described — Claude picks tools based
 * on the description, not the name.
 */

import type Anthropic from '@anthropic-ai/sdk';

export const ASSISTANT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'find_landmark',
    description:
      'Busca un lugar/punto popular de la ciudad por su nombre (universidades, centros comerciales, hospitales, plazas, barrios, etc.). Tolerante a typos leves. Usa esta tool cuando el usuario menciona un lugar por nombre, ej: "Uninorte", "Olímpica", "Centro", "Buenavista".',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Nombre o parte del nombre del lugar',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'find_routes_near',
    description:
      'Encuentra las rutas de bus tradicional cuyo corredor pasa cerca de una ubicación geográfica (lat/lng). Usa esta tool cuando el usuario quiere saber qué buses pasan por un punto específico.',
    input_schema: {
      type: 'object',
      properties: {
        lat: { type: 'number' },
        lng: { type: 'number' },
        radius_m: {
          type: 'integer',
          description: 'Radio en metros (default 100)',
          default: 100,
        },
      },
      required: ['lat', 'lng'],
    },
  },
  {
    name: 'get_buses_at_point',
    description:
      'Obtiene los próximos buses (con ETA en segundos) que pasarán por una ubicación específica. Usa esta tool cuando el usuario quiere saber CUÁNDO llega el próximo bus a su ubicación.',
    input_schema: {
      type: 'object',
      properties: {
        lat: { type: 'number' },
        lng: { type: 'number' },
      },
      required: ['lat', 'lng'],
    },
  },
  {
    name: 'calculate_trip',
    description:
      'Calcula la mejor ruta entre dos puntos (origen y destino), considerando rutas tradicionales que pasen cerca de ambos. Retorna ruta recomendada, tiempo estimado, y opciones alternativas si existen. Usa esta tool cuando el usuario quiere ir de un lugar a otro.',
    input_schema: {
      type: 'object',
      properties: {
        from_lat: { type: 'number' },
        from_lng: { type: 'number' },
        to_lat: { type: 'number' },
        to_lng: { type: 'number' },
        from_landmark_id: {
          type: 'string',
          description: 'Opcional: si el origen es un landmark conocido',
        },
        to_landmark_id: {
          type: 'string',
          description: 'Opcional: si el destino es un landmark conocido',
        },
      },
      required: ['from_lat', 'from_lng', 'to_lat', 'to_lng'],
    },
  },
];

export type ToolName = (typeof ASSISTANT_TOOLS)[number]['name'];
