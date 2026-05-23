/**
 * Common geo types and helpers shared across modules.
 *
 * Convention: in REST and WS payloads, coordinates are always `{lat, lng}`.
 * Only raw GeoJSON outputs use the `[lng, lat]` order.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface GeoJSONLineString {
  type: 'LineString';
  coordinates: [number, number][]; // [lng, lat][]
}

export interface GeoJSONFeature<P = Record<string, unknown>> {
  type: 'Feature';
  geometry: GeoJSONLineString;
  properties: P;
}

/**
 * Parse `POINT(lng lat)` WKT into LatLng.
 * Used when reading PostGIS columns via raw SQL with ST_AsText.
 */
export function parsePointWkt(wkt: string): LatLng | null {
  // POINT(-74.78 10.97)
  const m = /^POINT\(([-\d.eE]+)\s+([-\d.eE]+)\)$/.exec(wkt.trim());
  if (!m) return null;
  return { lng: Number(m[1]), lat: Number(m[2]) };
}

/**
 * Parse `LINESTRING(lng1 lat1, lng2 lat2, ...)` WKT into [lng, lat][] (GeoJSON order).
 */
export function parseLineStringWkt(wkt: string): [number, number][] {
  const m = /^LINESTRING\((.+)\)$/.exec(wkt.trim());
  if (!m) return [];
  return m[1].split(',').map((pair) => {
    const [lng, lat] = pair.trim().split(/\s+/).map(Number);
    return [lng, lat] as [number, number];
  });
}
