/**
 * Vialink — Rutas tradicionales de Barranquilla + Transmetro
 *
 * 14 rutas tradicionales (paran a demanda, sin paradas fijas)
 * + 2 rutas Transmetro (BRT con paradas fijas reales)
 *
 * Cada corridor es una secuencia de [lng, lat] (orden GeoJSON) que aproxima
 * el recorrido real. NO es preciso al metro — es plausible y se ve bien en el mapa.
 *
 * Para queries geoespaciales se convierte a `geography(LineString, 4326)` con
 * ST_MakeLine + ST_SetSRID. La distancia se calcula con ST_Length.
 */

import type { RouteMode } from '@prisma/client';

export type RoutePoint = readonly [lng: number, lat: number];

export type RouteSeed = {
  code: string;
  name: string;
  color: string;
  mode: RouteMode;
  stopsAreFixed: boolean;
  operator: string;
  /** Polyline [lng, lat][] siguiendo el corredor de la ruta */
  corridor: RoutePoint[];
  /** Solo para BRT: paradas fijas con su sequence */
  fixedStops?: { name: string; code?: string; sequence: number; lat: number; lng: number }[];
};

// ====================================================================
// RUTAS TRADICIONALES (14)
// ====================================================================

export const TRADITIONAL_ROUTES: RouteSeed[] = [
  // ---- C12 · Centro → Uninorte vía Carrera 46/Vía Pto Colombia ----
  {
    code: 'C12',
    name: 'Centro - Uninorte',
    color: '#1E5EFF',
    mode: 'TRADITIONAL',
    stopsAreFixed: false,
    operator: 'Coochofal',
    corridor: [
      [-74.7826, 10.9656], // Plaza San Nicolás (Centro)
      [-74.7858, 10.9740],
      [-74.7891, 10.9907], // Catedral
      [-74.7905, 10.9897], // Plaza de la Paz
      [-74.7938, 10.9968], // La Asunción
      [-74.7918, 10.9988], // Romelio Martínez
      [-74.8005, 11.0024], // Mall Plaza
      [-74.8090, 11.0048], // C Iberoamérica
      [-74.8208, 11.0093], // Buenavista I
      [-74.8395, 11.0185], // Riomar
      [-74.8499, 11.0186], // Uninorte
    ],
  },

  // ---- B7 · Buenavista → Centro vía Carrera 53 ----
  {
    code: 'B7',
    name: 'Buenavista - Centro',
    color: '#7C3AED',
    mode: 'TRADITIONAL',
    stopsAreFixed: false,
    operator: 'Sobusa',
    corridor: [
      [-74.8233, 11.0146], // Buenavista II
      [-74.8208, 11.0093], // Buenavista I
      [-74.8146, 11.0029], // Viva Bquilla
      [-74.8076, 11.0008], // Pq Sagrado Corazón
      [-74.8005, 11.0024], // Mall Plaza
      [-74.7951, 10.9805], // La Concepción
      [-74.7905, 10.9897], // Plaza de la Paz
      [-74.7891, 10.9907], // Catedral
      [-74.7826, 10.9656], // San Nicolás
    ],
  },

  // ---- R20 · Riomar → Centro vía Calle 84 + Cra 46 ----
  {
    code: 'R20',
    name: 'Riomar - Centro',
    color: '#10B981',
    mode: 'TRADITIONAL',
    stopsAreFixed: false,
    operator: 'Cootracegua',
    corridor: [
      [-74.8395, 11.0185], // Riomar
      [-74.8270, 11.0167], // Villa Carolina
      [-74.8208, 11.0124], // Villa Santos
      [-74.8094, 11.0061], // Caribe Plaza
      [-74.8090, 11.0050], // Zona Rosa
      [-74.7945, 10.9941], // Niño Jesús
      [-74.7920, 10.9869], // UniLibre
      [-74.7858, 10.9740],
      [-74.7826, 10.9656], // Centro
    ],
  },

  // ---- S8 · Soledad → Centro vía Avenida Murillo ----
  {
    code: 'S8',
    name: 'Soledad - Centro (Murillo)',
    color: '#F59E0B',
    mode: 'TRADITIONAL',
    stopsAreFixed: false,
    operator: 'Sodetrans',
    corridor: [
      [-74.7647, 10.9170], // Soledad Centro
      [-74.7715, 10.9296], // Soledad 2000
      [-74.7727, 10.9075], // (cerca Portal Soledad)
      [-74.7868, 10.9743], // Joe Arroyo (Murillo)
      [-74.7878, 10.9628], // CARI
      [-74.7826, 10.9656], // Centro / San Nicolás
    ],
  },

  // ---- C5 · Galapa → Centro vía Calle 30/Murillo ----
  {
    code: 'C5',
    name: 'Galapa - Centro',
    color: '#EC4899',
    mode: 'TRADITIONAL',
    stopsAreFixed: false,
    operator: 'Transcaribe',
    corridor: [
      [-74.8847, 10.8970], // Galapa
      [-74.8073, 10.9290], // Estadio Metropolitano
      [-74.8005, 10.9772], // Modelo
      [-74.7898, 10.9785], // Metrocentro
      [-74.7868, 10.9743], // Joe Arroyo
      [-74.7858, 10.9661], // Paseo Bolívar
      [-74.7826, 10.9656], // Centro
    ],
  },

  // ---- R1 · Las Flores → Centro vía Vía 40 ----
  {
    code: 'R1',
    name: 'Las Flores - Centro (Vía 40)',
    color: '#06B6D4',
    mode: 'TRADITIONAL',
    stopsAreFixed: false,
    operator: 'Coochofal',
    corridor: [
      [-74.8079, 11.0290], // Las Flores
      [-74.8009, 11.0203], // La Playa
      [-74.7919, 10.9919], // Malecón
      [-74.7754, 10.9919], // Gran Malecón
      [-74.7765, 10.9637], // Plaza Aduana
      [-74.7826, 10.9656], // Centro
    ],
  },

  // ---- M9 · Olaya → Norte vía Cra 38 + Calle 72 ----
  {
    code: 'M9',
    name: 'Olaya - Norte',
    color: '#F97316',
    mode: 'TRADITIONAL',
    stopsAreFixed: false,
    operator: 'Sobusa',
    corridor: [
      [-74.8019, 10.9596], // Olaya Herrera
      [-74.7972, 10.9580], // Estación Retorno
      [-74.7920, 10.9869], // UniLibre
      [-74.7938, 10.9968], // La Asunción
      [-74.7918, 10.9988], // Romelio Martínez
      [-74.8002, 11.0021], // UniMetro
      [-74.8076, 11.0008], // Sagrado Corazón
      [-74.8094, 11.0061], // Caribe Plaza
    ],
  },

  // ---- L4 · La Playa → Centro vía Cra 51B + Calle 76 ----
  {
    code: 'L4',
    name: 'La Playa - Centro',
    color: '#8B5CF6',
    mode: 'TRADITIONAL',
    stopsAreFixed: false,
    operator: 'Cootracegua',
    corridor: [
      [-74.8009, 11.0203], // La Playa
      [-74.8095, 11.0162], // Nuevo Bosque
      [-74.8125, 11.0080], // Las Mercedes
      [-74.8005, 11.0024], // Mall Plaza
      [-74.7898, 10.9785], // Metrocentro
      [-74.7826, 10.9656], // Centro
    ],
  },

  // ---- N3 · Riomar → Estadio Metropolitano (Norte-Sur) ----
  {
    code: 'N3',
    name: 'Riomar - Estadio Metropolitano',
    color: '#DC2626',
    mode: 'TRADITIONAL',
    stopsAreFixed: false,
    operator: 'Sodetrans',
    corridor: [
      [-74.8395, 11.0185], // Riomar
      [-74.8232, 11.0073], // Ciudad Jardín
      [-74.8118, 11.0089], // UniAutónoma
      [-74.8051, 11.0050], // CUC
      [-74.7935, 10.9919], // Pq Tomás Surí
      [-74.7878, 10.9628], // CARI
      [-74.8073, 10.9290], // Estadio Metropolitano
    ],
  },

  // ---- C15 · Loop Centros Comerciales Norte ----
  {
    code: 'C15',
    name: 'Loop Centros Comerciales',
    color: '#0EA5E9',
    mode: 'TRADITIONAL',
    stopsAreFixed: false,
    operator: 'Transcaribe',
    corridor: [
      [-74.8208, 11.0093], // Buenavista I
      [-74.8233, 11.0146], // Buenavista II
      [-74.8240, 11.0210], // Único Outlet Norte
      [-74.8146, 11.0029], // Viva
      [-74.8094, 11.0061], // Caribe Plaza
      [-74.8090, 11.0050], // Zona Rosa
      [-74.8005, 11.0024], // Mall Plaza
      [-74.8208, 11.0093], // de vuelta a Buenavista I
    ],
  },

  // ---- U7 · Universidades Loop ----
  {
    code: 'U7',
    name: 'Universidades',
    color: '#14B8A6',
    mode: 'TRADITIONAL',
    stopsAreFixed: false,
    operator: 'Coochofal',
    corridor: [
      [-74.8051, 11.0050], // CUC
      [-74.8061, 10.9974], // UniSimón
      [-74.8002, 11.0021], // UniMetro
      [-74.8118, 11.0089], // UniAutónoma
      [-74.7920, 10.9869], // UniLibre
      [-74.8499, 11.0186], // Uninorte
      [-74.8632, 11.0270], // UniAtlántico
    ],
  },

  // ---- S12 · Sabanilla → Centro ----
  {
    code: 'S12',
    name: 'Sabanilla - Centro',
    color: '#A855F7',
    mode: 'TRADITIONAL',
    stopsAreFixed: false,
    operator: 'Sobusa',
    corridor: [
      [-74.9285, 11.0250], // Sabanilla
      [-74.9501, 10.9962], // Puerto Colombia
      [-74.8642, 11.0398], // Portoazul
      [-74.8499, 11.0186], // Uninorte
      [-74.8233, 11.0146], // Buenavista II
      [-74.8005, 11.0024], // Mall Plaza
      [-74.7826, 10.9656], // Centro
    ],
  },

  // ---- A2 · Aeropuerto → Centro ----
  {
    code: 'A2',
    name: 'Aeropuerto - Centro',
    color: '#22C55E',
    mode: 'TRADITIONAL',
    stopsAreFixed: false,
    operator: 'Sodetrans',
    corridor: [
      [-74.7808, 10.8896], // Aeropuerto
      [-74.7727, 10.9075], // Portal Soledad
      [-74.7660, 10.9210], // Único Outlet Soledad
      [-74.7841, 10.9388], // Terminal de Transportes
      [-74.7898, 10.9785], // Metrocentro
      [-74.7826, 10.9656], // Centro
    ],
  },

  // ---- G3 · Granabastos → Centro ----
  {
    code: 'G3',
    name: 'Granabastos - Centro',
    color: '#EAB308',
    mode: 'TRADITIONAL',
    stopsAreFixed: false,
    operator: 'Transcaribe',
    corridor: [
      [-74.7995, 10.9335], // Granabastos
      [-74.7975, 10.9335],
      [-74.7894, 10.9523], // Rebolo
      [-74.7926, 10.9583], // San José
      [-74.7818, 10.9636], // Mercado Público
      [-74.7826, 10.9656], // Centro
    ],
  },
];

// ====================================================================
// RUTAS TRANSMETRO (BRT, 2)
// ====================================================================

export const TRANSMETRO_ROUTES: RouteSeed[] = [
  // ---- T1 · Troncal Murillo: Portal Soledad → Romelio Martínez ----
  {
    code: 'T1',
    name: 'Troncal Murillo',
    color: '#0F172A', // negro brand Transmetro
    mode: 'BRT',
    stopsAreFixed: true,
    operator: 'Transmetro',
    corridor: [
      [-74.7727, 10.9075], // Portal Soledad
      [-74.7868, 10.9743], // Joe Arroyo
      [-74.7905, 10.9897], // Plaza de la Paz
      [-74.7918, 10.9988], // Romelio Martínez
    ],
    fixedStops: [
      { name: 'Portal de Soledad', code: 'T1-01', sequence: 1, lat: 10.9075, lng: -74.7727 },
      { name: 'Soledad 2000', code: 'T1-02', sequence: 2, lat: 10.9296, lng: -74.7715 },
      { name: 'CARI', code: 'T1-03', sequence: 3, lat: 10.9628, lng: -74.7878 },
      { name: 'Joe Arroyo', code: 'T1-04', sequence: 4, lat: 10.9743, lng: -74.7868 },
      { name: 'Barlovento', code: 'T1-05', sequence: 5, lat: 10.9830, lng: -74.7886 },
      { name: 'Plaza de la Paz', code: 'T1-06', sequence: 6, lat: 10.9897, lng: -74.7905 },
      { name: 'Romelio Martínez', code: 'T1-07', sequence: 7, lat: 10.9988, lng: -74.7918 },
    ],
  },

  // ---- T2 · Troncal Olaya Herrera: Romelio → Retorno ----
  {
    code: 'T2',
    name: 'Troncal Olaya Herrera',
    color: '#0F172A',
    mode: 'BRT',
    stopsAreFixed: true,
    operator: 'Transmetro',
    corridor: [
      [-74.7918, 10.9988], // Romelio Martínez
      [-74.7938, 10.9968], // La Asunción
      [-74.7972, 10.9580], // Retorno
    ],
    fixedStops: [
      { name: 'Romelio Martínez', code: 'T2-01', sequence: 1, lat: 10.9988, lng: -74.7918 },
      { name: 'La Asunción', code: 'T2-02', sequence: 2, lat: 10.9968, lng: -74.7938 },
      { name: 'Manga', code: 'T2-03', sequence: 3, lat: 10.9870, lng: -74.7950 },
      { name: 'Las Nieves', code: 'T2-04', sequence: 4, lat: 10.9783, lng: -74.7935 },
      { name: 'Olaya', code: 'T2-05', sequence: 5, lat: 10.9700, lng: -74.7960 },
      { name: 'Retorno', code: 'T2-06', sequence: 6, lat: 10.9580, lng: -74.7972 },
    ],
  },
];

export const ALL_ROUTES = [...TRADITIONAL_ROUTES, ...TRANSMETRO_ROUTES];
