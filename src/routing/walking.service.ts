import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration';
import type { LatLng } from '../common/types/geo';

/**
 * Vialink — Walking directions service.
 *
 * Wraps Mapbox Directions API (walking profile) para obtener un polyline
 * que sigue calles reales entre dos puntos (en vez de la línea recta
 * usada antes). Devuelve también distancia + duración estimada.
 *
 * Cache LRU agresivo: misma (from, to) → misma respuesta. Las cuadras
 * de Barranquilla son pequeñas (~100m), así que redondeamos a 5
 * decimales (~1m) para el key.
 *
 * Costo Mapbox: free tier 100K Directions calls/mes. Cada recomendación
 * dispara 2 walking calls (user→board, alight→destino). Con cache, una
 * misma ruta no re-llama.
 */

export interface WalkingDirectionsResponse {
  polyline: LatLng[];
  distance_m: number;
  duration_seconds: number;
}

interface MapboxDirectionsResponse {
  routes: Array<{
    distance: number; // meters
    duration: number; // seconds
    geometry: {
      type: 'LineString';
      coordinates: [number, number][]; // [lng, lat]
    };
  }>;
  code: string;
}

interface CacheEntry {
  expiresAt: number;
  payload: WalkingDirectionsResponse;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h — caminatas no cambian
const MAX_CACHE_ENTRIES = 2000;

@Injectable()
export class WalkingService {
  private readonly logger = new Logger(WalkingService.name);
  private readonly token: string | null;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(config: ConfigService<AppConfig, true>) {
    const raw = config.get('MAPBOX_ACCESS_TOKEN', { infer: true });
    this.token =
      raw && !raw.includes('PLACEHOLDER') && raw.length > 10 ? raw : null;
    if (!this.token) {
      this.logger.warn(
        '⚠️  MAPBOX_ACCESS_TOKEN no configurado. ' +
          'Walking directions devolverá línea recta (fallback).',
      );
    }
  }

  /**
   * Devuelve un polyline de caminata entre dos puntos siguiendo calles
   * reales. Si Mapbox falla, devuelve un fallback con línea recta
   * + distancia haversine + duración estimada (~80m/min).
   */
  async getWalkingRoute(from: LatLng, to: LatLng): Promise<WalkingDirectionsResponse> {
    const key = this.cacheKey(from, to);
    const now = Date.now();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > now) {
      return cached.payload;
    }

    let result: WalkingDirectionsResponse;
    if (this.token) {
      try {
        result = await this.fetchFromMapbox(from, to);
      } catch (err) {
        this.logger.warn(
          `Mapbox walking falló (${(err as Error).message}). Usando fallback línea recta.`,
        );
        result = this.straightLineFallback(from, to);
      }
    } else {
      result = this.straightLineFallback(from, to);
    }

    this.cache.set(key, { expiresAt: now + CACHE_TTL_MS, payload: result });

    // LRU eviction simple — si pasamos el límite, borrar el más viejo
    if (this.cache.size > MAX_CACHE_ENTRIES) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }

    return result;
  }

  /**
   * Resuelve un batch de caminatas en paralelo. Útil cuando la recomendación
   * de ruta tiene 2 walks (user→board y alight→destination).
   */
  async getWalkingRoutesBatch(
    legs: Array<{ from: LatLng; to: LatLng }>,
  ): Promise<WalkingDirectionsResponse[]> {
    return Promise.all(legs.map(({ from, to }) => this.getWalkingRoute(from, to)));
  }

  private cacheKey(from: LatLng, to: LatLng): string {
    return [
      from.lat.toFixed(5),
      from.lng.toFixed(5),
      to.lat.toFixed(5),
      to.lng.toFixed(5),
    ].join('|');
  }

  private async fetchFromMapbox(
    from: LatLng,
    to: LatLng,
  ): Promise<WalkingDirectionsResponse> {
    const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
    const url =
      `https://api.mapbox.com/directions/v5/mapbox/walking/${coords}` +
      `?geometries=geojson&overview=full&access_token=${this.token}`;
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Mapbox ${res.status}: ${text.slice(0, 150)}`);
    }
    const data = (await res.json()) as MapboxDirectionsResponse;
    if (data.code !== 'Ok' || data.routes.length === 0) {
      throw new Error(`Mapbox response no-Ok: ${data.code}`);
    }
    const route = data.routes[0];
    return {
      polyline: route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
      distance_m: Math.round(route.distance),
      duration_seconds: Math.round(route.duration),
    };
  }

  private straightLineFallback(from: LatLng, to: LatLng): WalkingDirectionsResponse {
    const distance_m = Math.round(haversineMeters(from, to));
    // ~80 m/min (~1.3 m/s) — velocidad promedio caminando
    const duration_seconds = Math.round(distance_m / (80 / 60));
    return {
      polyline: [from, to],
      distance_m,
      duration_seconds,
    };
  }
}

function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
