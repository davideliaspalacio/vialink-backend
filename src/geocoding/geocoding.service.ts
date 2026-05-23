import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration';
import type { LatLng } from '../common/types/geo';

/**
 * Geocoding via Mapbox Geocoding API (v6).
 *
 * Why Mapbox:
 *   - 100K requests/month free (more than enough for hackathon + early prod)
 *   - High quality for Colombian addresses including "Calle X con Cra Y" format
 *   - No credit card required for free tier
 *   - Permissive rate limit (600 req/min) — no need to serialize requests
 *
 * Cache (TTL 1h) eliminates 95%+ of upstream calls in practice since the
 * same address is queried many times during a session.
 */

export interface GeocodeResult {
  formatted_address: string;
  location: LatLng;
  category: string | null;
  relevance: number;
  source: 'mapbox' | 'cache';
}

export interface GeocodeResponse {
  query: string;
  results: GeocodeResult[];
  cached: boolean;
  latency_ms: number;
}

interface MapboxV6FeatureProps {
  name?: string;
  full_address?: string;
  place_formatted?: string;
  feature_type?: string;
  match_code?: { confidence?: string };
}

interface MapboxV6Feature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: MapboxV6FeatureProps;
}

interface MapboxV6Response {
  type: 'FeatureCollection';
  features: MapboxV6Feature[];
}

interface CacheEntry {
  expiresAt: number;
  payload: GeocodeResult[];
}

/** Barranquilla bounding box (generous to include Soledad, Galapa, Puerto Colombia). */
const BAQ_BBOX = {
  minLng: -75.05,
  minLat: 10.85,
  maxLng: -74.70,
  maxLat: 11.15,
} as const;

const MAPBOX_URL = 'https://api.mapbox.com/search/geocode/v6/forward';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const REQUEST_TIMEOUT_MS = 8000;

@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);
  private readonly cache = new Map<string, CacheEntry>();
  private readonly accessToken: string | undefined;
  private readonly tokenAvailable: boolean;
  private cacheHits = 0;
  private cacheMisses = 0;

  constructor(config: ConfigService<AppConfig, true>) {
    const raw = config.get('MAPBOX_ACCESS_TOKEN', { infer: true });
    const looksReal =
      typeof raw === 'string' &&
      raw.length > 30 &&
      raw.startsWith('pk.') &&
      !raw.toLowerCase().includes('placeholder');
    this.accessToken = looksReal ? raw : undefined;
    this.tokenAvailable = !!this.accessToken;
    if (!this.tokenAvailable) {
      this.logger.warn(
        '⚠️ MAPBOX_ACCESS_TOKEN no configurado o es placeholder. ' +
        'El endpoint /geocode devolverá 503 hasta que se configure un pk.* válido.',
      );
    } else {
      this.logger.log('✅ Mapbox Geocoding listo');
    }
  }

  isAvailable(): boolean {
    return this.tokenAvailable;
  }

  async geocode(params: {
    query: string;
    proximity?: LatLng;
    limit?: number;
  }): Promise<GeocodeResponse> {
    const start = Date.now();
    const normalizedQuery = this.normalize(params.query);
    if (!normalizedQuery) {
      throw new HttpException('Empty query', HttpStatus.BAD_REQUEST);
    }

    const cacheKey = this.cacheKey(normalizedQuery, params.proximity, params.limit);
    const now = Date.now();
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      this.cacheHits++;
      return {
        query: params.query,
        results: cached.payload.map((r) => ({ ...r, source: 'cache' })),
        cached: true,
        latency_ms: Date.now() - start,
      };
    }
    this.cacheMisses++;

    if (!this.tokenAvailable) {
      throw new ServiceUnavailableException(
        'Geocoding no disponible: MAPBOX_ACCESS_TOKEN no configurado en el backend',
      );
    }

    const results = await this.callMapbox(
      normalizedQuery,
      params.proximity,
      params.limit ?? 5,
    );

    this.cache.set(cacheKey, { expiresAt: now + CACHE_TTL_MS, payload: results });

    if (this.cache.size > 500) {
      for (const [k, v] of this.cache) {
        if (v.expiresAt <= now) this.cache.delete(k);
      }
    }

    return {
      query: params.query,
      results,
      cached: false,
      latency_ms: Date.now() - start,
    };
  }

  /**
   * Convenience: geocode + return only the best match's coordinates.
   * Used by the assistant tool. Throws if no result.
   */
  async geocodeToPoint(
    query: string,
    proximity?: LatLng,
  ): Promise<{ location: LatLng; formatted_address: string }> {
    const response = await this.geocode({ query, proximity, limit: 1 });
    if (response.results.length === 0) {
      throw new HttpException(
        `No se encontró la dirección "${query}"`,
        HttpStatus.NOT_FOUND,
      );
    }
    return {
      location: response.results[0].location,
      formatted_address: response.results[0].formatted_address,
    };
  }

  getStats() {
    const total = this.cacheHits + this.cacheMisses;
    return {
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hit_rate: total === 0 ? 0 : +(this.cacheHits / total).toFixed(3),
      cache_entries: this.cache.size,
      mapbox_token_configured: this.tokenAvailable,
    };
  }

  // ============================================================
  // Internals
  // ============================================================

  private async callMapbox(
    query: string,
    proximity: LatLng | undefined,
    limit: number,
  ): Promise<GeocodeResult[]> {
    // Mapbox v6 doesn't understand Colombian "con": "Calle 84 con Cra 50".
    // Normalize to the postal format it accepts: "Calle 84 50, Barranquilla".
    const normalized = this.normalizeColombianAddress(query);

    const params = new URLSearchParams({
      q: normalized,
      limit: String(Math.min(limit, 10)),
      country: 'co',
      language: 'es',
      // Mapbox v6 valid types (per error msg): country, region, place, district,
      // locality, postcode, neighborhood, address.
      // We exclude country/region/postcode/district to keep results local.
      types: 'address,place,locality,neighborhood',
      access_token: this.accessToken!,
    });
    if (proximity) {
      // proximity biases results but doesn't restrict them — better than bbox
      // which returns empty for valid out-of-zone addresses
      params.set('proximity', `${proximity.lng},${proximity.lat}`);
    }

    const url = `${MAPBOX_URL}?${params.toString()}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(url, { method: 'GET', signal: controller.signal });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.logger.warn(
          `Mapbox returned ${res.status} for "${query}": ${body.slice(0, 200)}`,
        );
        throw new HttpException(
          `Geocoding upstream error (${res.status})`,
          HttpStatus.BAD_GATEWAY,
        );
      }

      const raw = (await res.json()) as MapboxV6Response;
      return raw.features.map((f) => {
        const [lng, lat] = f.geometry.coordinates;
        const props = f.properties;
        return {
          formatted_address:
            props.full_address ?? props.place_formatted ?? props.name ?? '',
          location: { lat, lng },
          category: props.feature_type ?? null,
          relevance: this.relevanceFromConfidence(props.match_code?.confidence),
          source: 'mapbox' as const,
        };
      });
    } catch (err) {
      if (err instanceof HttpException) throw err;
      const msg = (err as Error).message ?? 'Unknown error';
      this.logger.error(`Mapbox call failed for "${query}": ${msg}`);
      throw new HttpException(
        'Geocoding service unavailable',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private relevanceFromConfidence(c?: string): number {
    switch (c) {
      case 'exact': return 1.0;
      case 'high': return 0.8;
      case 'medium': return 0.5;
      case 'low': return 0.2;
      default: return 0;
    }
  }

  private normalize(q: string): string {
    return q.trim().replace(/\s+/g, ' ');
  }

  /**
   * Mapbox no entiende el formato típico colombiano "Calle X con Cra Y".
   * Esta función normaliza a algo que Mapbox sí indexó:
   *   "Calle 84 con Cra 50"  →  "Calle 84 50, Barranquilla"
   *   "Cra 46 con Calle 53"  →  "Carrera 46 53, Barranquilla"
   *   "Diagonal 23 #45-67"   →  "Diagonal 23 45-67, Barranquilla"
   *   "Plaza San Nicolás"    →  "Plaza San Nicolás, Barranquilla"
   *
   * Si el usuario ya incluyó "Barranquilla" o cualquier mención de ciudad,
   * no la duplica.
   */
  private normalizeColombianAddress(q: string): string {
    let out = q.trim();

    // 1) Reemplazar abreviaturas comunes
    out = out
      .replace(/\bCra\.?\b/gi, 'Carrera')
      .replace(/\bKra\.?\b/gi, 'Carrera')
      .replace(/\bCl\.?\b/gi, 'Calle')
      .replace(/\bAv\.?\b/gi, 'Avenida')
      .replace(/\bDg\.?\b/gi, 'Diagonal')
      .replace(/\bTv\.?\b/gi, 'Transversal');

    // 2) Reemplazar el conector colombiano "con" entre números/calles por espacio
    //    "Calle 84 con Carrera 50"  →  "Calle 84 Carrera 50"
    out = out.replace(/(\d|\bCalle|\bCarrera|\bAvenida|\bDiagonal|\bTransversal)\s+con\s+/gi, '$1 ');

    // 3) Limpiar el símbolo # en direcciones "Cra 46 #53-12" → "Cra 46 53-12"
    out = out.replace(/\s*#\s*/g, ' ');

    // 4) Colapsar espacios múltiples
    out = out.replace(/\s+/g, ' ').trim();

    // 5) Agregar ", Barranquilla" si no menciona ya alguna ciudad/municipio
    const mentionsCity = /\b(Barranquilla|Soledad|Galapa|Puerto Colombia|Sabanilla|Malambo)\b/i.test(out);
    if (!mentionsCity) {
      out = `${out}, Barranquilla`;
    }

    return out;
  }

  private cacheKey(query: string, proximity?: LatLng, limit?: number): string {
    const p = proximity
      ? `:${proximity.lat.toFixed(3)},${proximity.lng.toFixed(3)}`
      : '';
    return `${query.toLowerCase()}${p}:${limit ?? 5}`;
  }
}
