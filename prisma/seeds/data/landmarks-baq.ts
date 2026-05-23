/**
 * Vialink — 80 landmarks reales de Barranquilla
 *
 * Coordenadas en formato {lat, lng} WGS84.
 * Verificadas aproximadamente contra Google Maps; ajustar después si hay desvíos.
 *
 * Categorías balanceadas:
 *   UNIVERSITY     · 8
 *   MALL           · 10
 *   HOSPITAL       · 7
 *   SQUARE         · 8  (plazas, parques, paseos)
 *   TRANSPORT_HUB  · 6
 *   NEIGHBORHOOD   · 30 (barrios y zonas conocidas)
 *   LANDMARK       · 11 (estadios, museos, iglesias, mercados, miradores)
 *   TOTAL          · 80
 */

import type { LandmarkType } from '@prisma/client';

export type LandmarkSeed = {
  name: string;
  type: LandmarkType;
  address?: string;
  lat: number;
  lng: number;
};

export const LANDMARKS_BAQ: LandmarkSeed[] = [
  // ===== UNIVERSIDADES (8) =====
  { name: 'Universidad del Norte', type: 'UNIVERSITY', address: 'Km 5 Vía Puerto Colombia', lat: 11.0186, lng: -74.8499 },
  { name: 'Universidad del Atlántico (Sede Norte)', type: 'UNIVERSITY', address: 'Km 7 Vía Puerto Colombia', lat: 11.0270, lng: -74.8632 },
  { name: 'Universidad de la Costa (CUC)', type: 'UNIVERSITY', address: 'Calle 58 #55-66', lat: 11.0050, lng: -74.8051 },
  { name: 'Universidad Libre Barranquilla', type: 'UNIVERSITY', address: 'Carrera 46 #48-170', lat: 10.9869, lng: -74.7920 },
  { name: 'Universidad Simón Bolívar', type: 'UNIVERSITY', address: 'Carrera 59 #59-65', lat: 10.9974, lng: -74.8061 },
  { name: 'Universidad Autónoma del Caribe', type: 'UNIVERSITY', address: 'Calle 90 #46-112', lat: 11.0089, lng: -74.8118 },
  { name: 'Universidad Metropolitana', type: 'UNIVERSITY', address: 'Calle 76 #42-78', lat: 11.0021, lng: -74.8002 },
  { name: 'ITSA Soledad', type: 'UNIVERSITY', address: 'Calle 18 #39-100, Soledad', lat: 10.9170, lng: -74.7647 },

  // ===== CENTROS COMERCIALES (10) =====
  { name: 'Mall Plaza El Castillo', type: 'MALL', address: 'Calle 76 #45-15', lat: 11.0024, lng: -74.8005 },
  { name: 'Buenavista I', type: 'MALL', address: 'Carrera 53 #98-99', lat: 11.0093, lng: -74.8208 },
  { name: 'Buenavista II', type: 'MALL', address: 'Carrera 53 #103-100', lat: 11.0146, lng: -74.8233 },
  { name: 'Centro Comercial Único Barranquilla', type: 'MALL', address: 'Calle 17 #2-150', lat: 10.9462, lng: -74.7878 },
  { name: 'Viva Barranquilla', type: 'MALL', address: 'Carrera 51 #87-65', lat: 11.0029, lng: -74.8146 },
  { name: 'Portal del Prado', type: 'MALL', address: 'Calle 53 #46-192', lat: 10.9907, lng: -74.7912 },
  { name: 'Centro Comercial Metrocentro', type: 'MALL', address: 'Calle 45 #38-58', lat: 10.9785, lng: -74.7898 },
  { name: 'Único Outlet Soledad', type: 'MALL', address: 'Calle 30 #20-100, Soledad', lat: 10.9210, lng: -74.7660 },
  { name: 'Centro Comercial Caribe Plaza', type: 'MALL', address: 'Calle 84 #51B-09', lat: 11.0061, lng: -74.8094 },
  { name: 'Centro Comercial Único Outlet Norte', type: 'MALL', address: 'Carrera 51B #110-99', lat: 11.0210, lng: -74.8240 },

  // ===== HOSPITALES (7) =====
  { name: 'Hospital Universitario CARI', type: 'HOSPITAL', address: 'Calle 14 #43-78', lat: 10.9628, lng: -74.7878 },
  { name: 'Clínica Reina Catalina', type: 'HOSPITAL', address: 'Carrera 52 #84-180', lat: 11.0034, lng: -74.8115 },
  { name: 'Hospital Niño Jesús', type: 'HOSPITAL', address: 'Calle 68 #44-99', lat: 10.9941, lng: -74.7945 },
  { name: 'Clínica La Asunción', type: 'HOSPITAL', address: 'Calle 70B #41-103', lat: 10.9968, lng: -74.7938 },
  { name: 'Clínica Iberoamérica', type: 'HOSPITAL', address: 'Calle 87 #50-22', lat: 11.0048, lng: -74.8090 },
  { name: 'Clínica Portoazul', type: 'HOSPITAL', address: 'Anillo Vial Corredor Universitario', lat: 11.0398, lng: -74.8642 },
  { name: 'Clínica del Caribe', type: 'HOSPITAL', address: 'Carrera 50 #80-149', lat: 11.0020, lng: -74.8079 },

  // ===== PLAZAS Y ESPACIOS PÚBLICOS (8) =====
  { name: 'Plaza de la Paz Juan Pablo II', type: 'SQUARE', address: 'Carrera 46 con Calle 53', lat: 10.9897, lng: -74.7905 },
  { name: 'Plaza San Nicolás', type: 'SQUARE', address: 'Carrera 42 con Calle 33', lat: 10.9656, lng: -74.7826 },
  { name: 'Paseo Bolívar', type: 'SQUARE', address: 'Calle 34 entre Cras 38 y 44', lat: 10.9661, lng: -74.7858 },
  { name: 'Parque Sagrado Corazón', type: 'SQUARE', address: 'Carrera 53 con Calle 75', lat: 11.0008, lng: -74.8076 },
  { name: 'Plaza de la Aduana', type: 'SQUARE', address: 'Vía 40 con Calle 30', lat: 10.9637, lng: -74.7765 },
  { name: 'Gran Malecón del Río', type: 'SQUARE', address: 'Vía 40, ribera occidental', lat: 10.9919, lng: -74.7754 },
  { name: 'Parque Tomás Surí Salcedo', type: 'SQUARE', address: 'Carrera 43 con Calle 65', lat: 10.9919, lng: -74.7935 },
  { name: 'Parque Venezuela', type: 'SQUARE', address: 'Calle 70 con Carrera 47', lat: 10.9966, lng: -74.7942 },

  // ===== HUBS DE TRANSPORTE (6) =====
  { name: 'Terminal de Transportes', type: 'TRANSPORT_HUB', address: 'Calle 34 Carrera 1', lat: 10.9388, lng: -74.7841 },
  { name: 'Aeropuerto Ernesto Cortissoz', type: 'TRANSPORT_HUB', address: 'Soledad', lat: 10.8896, lng: -74.7808 },
  { name: 'Estación Joe Arroyo (Transmetro)', type: 'TRANSPORT_HUB', address: 'Avenida Murillo', lat: 10.9743, lng: -74.7868 },
  { name: 'Estación Retorno (Transmetro)', type: 'TRANSPORT_HUB', address: 'Avenida Olaya Herrera', lat: 10.9580, lng: -74.7972 },
  { name: 'Estación Romelio Martínez (Transmetro)', type: 'TRANSPORT_HUB', address: 'Calle 72 con Cra 46', lat: 10.9988, lng: -74.7918 },
  { name: 'Portal de Soledad (Transmetro)', type: 'TRANSPORT_HUB', address: 'Soledad', lat: 10.9075, lng: -74.7727 },

  // ===== BARRIOS / ZONAS (30) =====
  { name: 'Centro Histórico', type: 'NEIGHBORHOOD', address: 'Centro', lat: 10.9665, lng: -74.7849 },
  { name: 'El Prado', type: 'NEIGHBORHOOD', address: 'El Prado', lat: 10.9905, lng: -74.7958 },
  { name: 'Alto Prado', type: 'NEIGHBORHOOD', address: 'Alto Prado', lat: 11.0095, lng: -74.8084 },
  { name: 'Riomar', type: 'NEIGHBORHOOD', address: 'Riomar', lat: 11.0185, lng: -74.8395 },
  { name: 'Villa Country', type: 'NEIGHBORHOOD', address: 'Villa Country', lat: 11.0061, lng: -74.8155 },
  { name: 'Villa Santos', type: 'NEIGHBORHOOD', address: 'Villa Santos', lat: 11.0124, lng: -74.8208 },
  { name: 'Boston', type: 'NEIGHBORHOOD', address: 'Boston', lat: 10.9836, lng: -74.7902 },
  { name: 'El Recreo', type: 'NEIGHBORHOOD', address: 'El Recreo', lat: 10.9928, lng: -74.7944 },
  { name: 'Las Mercedes', type: 'NEIGHBORHOOD', address: 'Las Mercedes', lat: 11.0080, lng: -74.8125 },
  { name: 'La Concepción', type: 'NEIGHBORHOOD', address: 'La Concepción', lat: 10.9805, lng: -74.7951 },
  { name: 'Modelo', type: 'NEIGHBORHOOD', address: 'Barrio Modelo', lat: 10.9772, lng: -74.8005 },
  { name: 'Olaya Herrera', type: 'NEIGHBORHOOD', address: 'Olaya Herrera', lat: 10.9596, lng: -74.8019 },
  { name: 'La Manga', type: 'NEIGHBORHOOD', address: 'La Manga', lat: 10.9989, lng: -74.8197 },
  { name: 'Las Flores', type: 'NEIGHBORHOOD', address: 'Las Flores', lat: 11.0290, lng: -74.8079 },
  { name: 'La Playa', type: 'NEIGHBORHOOD', address: 'La Playa', lat: 11.0203, lng: -74.8009 },
  { name: 'Los Andes', type: 'NEIGHBORHOOD', address: 'Los Andes', lat: 10.9888, lng: -74.8085 },
  { name: 'Ciudad Jardín', type: 'NEIGHBORHOOD', address: 'Ciudad Jardín', lat: 11.0073, lng: -74.8232 },
  { name: 'Villa Carolina', type: 'NEIGHBORHOOD', address: 'Villa Carolina', lat: 11.0167, lng: -74.8270 },
  { name: 'Nuevo Bosque', type: 'NEIGHBORHOOD', address: 'Nuevo Bosque', lat: 11.0162, lng: -74.8095 },
  { name: 'El Silencio', type: 'NEIGHBORHOOD', address: 'El Silencio', lat: 10.9716, lng: -74.8123 },
  { name: 'San José', type: 'NEIGHBORHOOD', address: 'San José', lat: 10.9583, lng: -74.7926 },
  { name: 'Rebolo', type: 'NEIGHBORHOOD', address: 'Rebolo', lat: 10.9523, lng: -74.7894 },
  { name: 'La Cumbre', type: 'NEIGHBORHOOD', address: 'La Cumbre', lat: 11.0203, lng: -74.8125 },
  { name: 'Las Nieves', type: 'NEIGHBORHOOD', address: 'Las Nieves', lat: 10.9783, lng: -74.7935 },
  { name: 'Granabastos', type: 'NEIGHBORHOOD', address: 'Granabastos', lat: 10.9335, lng: -74.7975 },
  { name: 'Soledad Centro', type: 'NEIGHBORHOOD', address: 'Soledad Centro', lat: 10.9176, lng: -74.7647 },
  { name: 'Soledad 2000', type: 'NEIGHBORHOOD', address: 'Soledad 2000', lat: 10.9296, lng: -74.7715 },
  { name: 'Galapa Centro', type: 'NEIGHBORHOOD', address: 'Galapa', lat: 10.8970, lng: -74.8847 },
  { name: 'Puerto Colombia', type: 'NEIGHBORHOOD', address: 'Puerto Colombia', lat: 10.9962, lng: -74.9501 },
  { name: 'Sabanilla', type: 'NEIGHBORHOOD', address: 'Sabanilla', lat: 11.0250, lng: -74.9285 },

  // ===== OTROS LANDMARKS (11) =====
  { name: 'Estadio Metropolitano Roberto Meléndez', type: 'LANDMARK', address: 'Calle 30 #74-15', lat: 10.9290, lng: -74.8073 },
  { name: 'Estadio Romelio Martínez', type: 'LANDMARK', address: 'Carrera 46 con Calle 72', lat: 10.9988, lng: -74.7918 },
  { name: 'Catedral Metropolitana María Reina', type: 'LANDMARK', address: 'Carrera 45 con Calle 53', lat: 10.9907, lng: -74.7891 },
  { name: 'Casa del Carnaval', type: 'LANDMARK', address: 'Carrera 54 #49B-39', lat: 10.9837, lng: -74.8004 },
  { name: 'Museo del Caribe', type: 'LANDMARK', address: 'Calle 36 #46-66', lat: 10.9709, lng: -74.7886 },
  { name: 'Bocas de Ceniza', type: 'LANDMARK', address: 'Tajamar Occidental', lat: 11.0937, lng: -74.8513 },
  { name: 'Mercado Granabastos', type: 'LANDMARK', address: 'Calle 8B con Cra 31', lat: 10.9330, lng: -74.7995 },
  { name: 'Mercado Público Centro', type: 'LANDMARK', address: 'Carrera 44 con Calle 32', lat: 10.9636, lng: -74.7818 },
  { name: 'Parque Cultural del Caribe', type: 'LANDMARK', address: 'Calle 36 #46-66', lat: 10.9712, lng: -74.7889 },
  { name: 'Castillo de Salgar', type: 'LANDMARK', address: 'Puerto Salgar', lat: 11.0085, lng: -74.9385 },
  { name: 'Zona Rosa Calle 84', type: 'LANDMARK', address: 'Calle 84 entre Cras 50 y 53', lat: 11.0050, lng: -74.8090 },
];

// Verificar conteo en build
if (LANDMARKS_BAQ.length !== 80) {
  throw new Error(`LANDMARKS_BAQ must have exactly 80 entries, got ${LANDMARKS_BAQ.length}`);
}
