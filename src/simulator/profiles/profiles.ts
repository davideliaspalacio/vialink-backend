/**
 * Vialink Simulator — 6 agent profiles for Barranquilla.
 *
 * Each profile encodes one realistic class of public-transit user.
 * Tuned together so the city feels alive: morning rush dominated by
 * students + executives, midday by vendors + housewives, evening peak,
 * and a small nighttime tail of nightlife agents.
 */

import { AgentProfile } from '@prisma/client';
import type { ProfileBehavior, ProfileSpawn } from './types';

// ============================================================
// 1. STUDENT_UNINORTE — estudiantes universidades del norte
// ============================================================
const studentUninorte: ProfileBehavior = {
  key: AgentProfile.STUDENT_UNINORTE,
  label: 'Estudiante Uninorte',
  hours: { active: [6, 7, 8, 9, 12, 13, 14, 16, 17, 18, 19, 20, 21], asleep: [0, 1, 2, 3, 4, 5] },
  pickDestination: (home, work, hour) => {
    if (hour >= 6 && hour <= 9 && work) {
      return { name: 'Universidad del Norte', location: work };
    }
    if (hour >= 16 && hour <= 19 && work) {
      return { name: 'Casa', location: home };
    }
    return null; // queda en su zona
  },
  weights: { askAi: 0.4, reportIncident: 0.02, rateTrip: 0.8, saveFavorite: 0.01 },
  questionBank: {
    questions: [
      '¿A qué hora pasa el próximo bus a Uninorte?',
      '¿Cómo llego al Centro de afán?',
      '¿Qué ruta me deja más cerca de la biblioteca?',
      'Voy tarde a clase, ¿cuál es la opción más rápida?',
      '¿Hay trancón en la 53?',
    ],
  },
  walkingSpeedKmh: 5.5,
  sampleNames: ['María', 'Andrés', 'Camila', 'Juan', 'Valentina', 'Daniel', 'Sara', 'Sebastián'],
};

// ============================================================
// 2. STREET_VENDOR — vendedores ambulantes del Centro
// ============================================================
const streetVendor: ProfileBehavior = {
  key: AgentProfile.STREET_VENDOR,
  label: 'Vendedor ambulante',
  hours: { active: [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19], asleep: [22, 23, 0, 1, 2, 3, 4, 5] },
  pickDestination: (home, _work, hour, rng) => {
    if (hour >= 6 && hour <= 8) {
      return { name: 'Centro Histórico', location: { lat: 10.9665, lng: -74.7849 } };
    }
    if (hour >= 18 && hour <= 19) {
      return { name: 'Casa', location: home };
    }
    // Mid-day: occasionally moves between zones
    if (rng < 0.3) {
      const zones = [
        { name: 'Plaza San Nicolás', lat: 10.9656, lng: -74.7826 },
        { name: 'Paseo Bolívar', lat: 10.9661, lng: -74.7858 },
        { name: 'Mercado Público', lat: 10.9636, lng: -74.7818 },
      ];
      const z = zones[Math.floor(rng * zones.length) % zones.length];
      return { name: z.name, location: { lat: z.lat, lng: z.lng } };
    }
    return null;
  },
  weights: { askAi: 0.08, reportIncident: 0.06, rateTrip: 0.5, saveFavorite: 0.005 },
  questionBank: {
    questions: [
      '¿Qué bus me deja en Granabastos?',
      '¿Está pasando el bus para Soledad?',
      '¿Hay alguna ruta hasta la Aduana?',
      '¿Cuánto se demora la C5?',
    ],
  },
  walkingSpeedKmh: 4.8,
  sampleNames: ['Carlos', 'Luis', 'Marta', 'Pedro', 'Diana', 'Wilmer', 'Yesenia', 'Ramiro'],
};

// ============================================================
// 3. EXECUTIVE_NORTE — ejecutivos zona norte
// ============================================================
const executiveNorte: ProfileBehavior = {
  key: AgentProfile.EXECUTIVE_NORTE,
  label: 'Ejecutivo Norte',
  hours: { active: [6, 7, 8, 11, 12, 13, 17, 18, 19, 20], asleep: [23, 0, 1, 2, 3, 4, 5] },
  pickDestination: (home, work, hour) => {
    if (hour >= 6 && hour <= 8 && work) {
      return { name: 'Oficina', location: work };
    }
    if (hour >= 17 && hour <= 19 && work) {
      return { name: 'Casa', location: home };
    }
    if (hour >= 12 && hour <= 13) {
      return { name: 'Almuerzo Calle 84', location: { lat: 11.005, lng: -74.809 } };
    }
    return null;
  },
  weights: { askAi: 0.15, reportIncident: 0.03, rateTrip: 0.7, saveFavorite: 0.02 },
  questionBank: {
    questions: [
      '¿Cuál es la ruta más rápida al Norte?',
      '¿A qué hora deja de pasar la C12?',
      '¿Hay un bus directo a Buenavista?',
      'Necesito llegar al aeropuerto, ¿qué opciones tengo?',
      '¿Está cerrada la Vía 40?',
    ],
  },
  walkingSpeedKmh: 5,
  sampleNames: ['Andrea', 'Ricardo', 'Patricia', 'Felipe', 'Mónica', 'Jaime', 'Liliana', 'Alejandro'],
};

// ============================================================
// 4. HOUSEWIFE_SURORIENTE — amas de casa zona sur
// ============================================================
const housewifeSuroriente: ProfileBehavior = {
  key: AgentProfile.HOUSEWIFE_SURORIENTE,
  label: 'Ama de casa Suroriente',
  hours: { active: [7, 8, 9, 10, 14, 15, 16], asleep: [22, 23, 0, 1, 2, 3, 4, 5] },
  pickDestination: (home, _work, hour, rng) => {
    if (hour >= 8 && hour <= 10) {
      const destinations = [
        { name: 'Mercado Granabastos', lat: 10.9335, lng: -74.7975 },
        { name: 'Centro Comercial Único Soledad', lat: 10.921, lng: -74.766 },
        { name: 'Hospital CARI', lat: 10.9628, lng: -74.7878 },
      ];
      const d = destinations[Math.floor(rng * destinations.length) % destinations.length];
      return { name: d.name, location: { lat: d.lat, lng: d.lng } };
    }
    if (hour >= 14 && hour <= 16) {
      return { name: 'Casa', location: home };
    }
    return null;
  },
  weights: { askAi: 0.06, reportIncident: 0.08, rateTrip: 0.55, saveFavorite: 0.03 },
  questionBank: {
    questions: [
      '¿Cuál bus me lleva al CARI?',
      '¿Hay un bus para Soledad ahorita?',
      '¿Está pasando la S8?',
      '¿Cómo llego a Granabastos?',
    ],
  },
  walkingSpeedKmh: 4.5,
  sampleNames: ['Rosa', 'Carmen', 'Esperanza', 'Gloria', 'Yolanda', 'Yamile', 'Lourdes', 'Cecilia'],
};

// ============================================================
// 5. TOURIST — turistas (hoteles → atracciones)
// ============================================================
const tourist: ProfileBehavior = {
  key: AgentProfile.TOURIST,
  label: 'Turista',
  hours: { active: [8, 9, 10, 11, 12, 14, 15, 16, 17, 18, 19, 20], asleep: [0, 1, 2, 3, 4, 5, 6] },
  pickDestination: (_home, _work, _hour, rng) => {
    const attractions = [
      { name: 'Casa del Carnaval', lat: 10.9837, lng: -74.8004 },
      { name: 'Museo del Caribe', lat: 10.9709, lng: -74.7886 },
      { name: 'Gran Malecón', lat: 10.9919, lng: -74.7754 },
      { name: 'Bocas de Ceniza', lat: 11.0937, lng: -74.8513 },
      { name: 'Catedral Metropolitana', lat: 10.9907, lng: -74.7891 },
      { name: 'Estadio Metropolitano', lat: 10.929, lng: -74.8073 },
      { name: 'Buenavista I', lat: 11.0093, lng: -74.8208 },
    ];
    const a = attractions[Math.floor(rng * attractions.length) % attractions.length];
    return { name: a.name, location: { lat: a.lat, lng: a.lng } };
  },
  weights: { askAi: 0.6, reportIncident: 0.01, rateTrip: 0.9, saveFavorite: 0.1 },
  questionBank: {
    questions: [
      '¿Cómo llego al Museo del Caribe?',
      '¿Qué bus me lleva a Bocas de Ceniza?',
      '¿Dónde queda la Casa del Carnaval?',
      '¿Cuánto cuesta el bus al estadio?',
      '¿Hay algún bus turístico?',
      '¿Cómo regreso al hotel del Centro?',
    ],
  },
  walkingSpeedKmh: 4,
  sampleNames: ['Sophie', 'Marco', 'Lucía', 'Hans', 'Isabel', 'Tomás', 'Ana', 'James'],
};

// ============================================================
// 6. NIGHTLIFE_ATTENDEE — vida nocturna
// ============================================================
const nightlifeAttendee: ProfileBehavior = {
  key: AgentProfile.NIGHTLIFE_ATTENDEE,
  label: 'Vida nocturna',
  hours: { active: [19, 20, 21, 22, 23, 0, 1, 2], asleep: [3, 4, 5, 6, 7, 8, 9, 10, 11] },
  pickDestination: (home, _work, hour) => {
    if (hour >= 19 && hour <= 22) {
      return { name: 'Zona Rosa Calle 84', location: { lat: 11.005, lng: -74.809 } };
    }
    if (hour >= 1 && hour <= 2) {
      return { name: 'Casa', location: home };
    }
    return null;
  },
  weights: { askAi: 0.25, reportIncident: 0.04, rateTrip: 0.4, saveFavorite: 0.01 },
  questionBank: {
    questions: [
      '¿Qué bus pasa a esta hora por la 84?',
      '¿Cómo me devuelvo a la casa?',
      '¿Hay buses después de medianoche?',
      '¿Cuánto se demora un bus al norte ahorita?',
    ],
  },
  walkingSpeedKmh: 4.5,
  sampleNames: ['Sebas', 'Vale', 'Mateo', 'Laura', 'Diego', 'Manuela', 'Santiago', 'Daniela'],
};

// ============================================================
// SPAWN ZONES — home/work zones per profile (real BAQ coords)
// ============================================================
export const PROFILE_SPAWNS: Record<AgentProfile, ProfileSpawn> = {
  STUDENT_UNINORTE: {
    homeZones: [
      { name: 'Riomar', lat: 11.0185, lng: -74.8395 },
      { name: 'El Prado', lat: 10.9905, lng: -74.7958 },
      { name: 'Boston', lat: 10.9836, lng: -74.7902 },
      { name: 'Modelo', lat: 10.9772, lng: -74.8005 },
      { name: 'Las Mercedes', lat: 11.008, lng: -74.8125 },
      { name: 'Buenavista', lat: 11.0093, lng: -74.8208 },
    ],
    workZones: [
      { name: 'Universidad del Norte', lat: 11.0186, lng: -74.8499 },
      { name: 'Universidad del Atlántico', lat: 11.027, lng: -74.8632 },
      { name: 'CUC', lat: 11.005, lng: -74.8051 },
      { name: 'UniSimón', lat: 10.9974, lng: -74.8061 },
    ],
  },
  STREET_VENDOR: {
    homeZones: [
      { name: 'Rebolo', lat: 10.9523, lng: -74.7894 },
      { name: 'San José', lat: 10.9583, lng: -74.7926 },
      { name: 'El Silencio', lat: 10.9716, lng: -74.8123 },
      { name: 'Soledad Centro', lat: 10.9176, lng: -74.7647 },
      { name: 'Olaya Herrera', lat: 10.9596, lng: -74.8019 },
    ],
  },
  EXECUTIVE_NORTE: {
    homeZones: [
      { name: 'Alto Prado', lat: 11.0095, lng: -74.8084 },
      { name: 'Villa Country', lat: 11.0061, lng: -74.8155 },
      { name: 'Villa Santos', lat: 11.0124, lng: -74.8208 },
      { name: 'Ciudad Jardín', lat: 11.0073, lng: -74.8232 },
      { name: 'Riomar', lat: 11.0185, lng: -74.8395 },
    ],
    workZones: [
      { name: 'Centro Empresarial Buenavista', lat: 11.0093, lng: -74.8208 },
      { name: 'Calle 84', lat: 11.005, lng: -74.809 },
      { name: 'Caribe Plaza', lat: 11.0061, lng: -74.8094 },
      { name: 'Mall Plaza', lat: 11.0024, lng: -74.8005 },
    ],
  },
  HOUSEWIFE_SURORIENTE: {
    homeZones: [
      { name: 'Soledad 2000', lat: 10.9296, lng: -74.7715 },
      { name: 'Soledad Centro', lat: 10.9176, lng: -74.7647 },
      { name: 'Granabastos', lat: 10.9335, lng: -74.7975 },
      { name: 'Olaya Herrera', lat: 10.9596, lng: -74.8019 },
      { name: 'Rebolo', lat: 10.9523, lng: -74.7894 },
    ],
  },
  TOURIST: {
    homeZones: [
      { name: 'Hotel El Prado', lat: 10.9905, lng: -74.7958 },
      { name: 'Hotel Centro', lat: 10.9665, lng: -74.7849 },
      { name: 'Hotel Buenavista', lat: 11.0093, lng: -74.8208 },
      { name: 'Hotel Norte', lat: 11.0185, lng: -74.8395 },
    ],
  },
  NIGHTLIFE_ATTENDEE: {
    homeZones: [
      { name: 'El Prado', lat: 10.9905, lng: -74.7958 },
      { name: 'Boston', lat: 10.9836, lng: -74.7902 },
      { name: 'Villa Country', lat: 11.0061, lng: -74.8155 },
      { name: 'Alto Prado', lat: 11.0095, lng: -74.8084 },
    ],
  },
};

// ============================================================
// Registry
// ============================================================
export const PROFILES: Record<AgentProfile, ProfileBehavior> = {
  STUDENT_UNINORTE: studentUninorte,
  STREET_VENDOR: streetVendor,
  EXECUTIVE_NORTE: executiveNorte,
  HOUSEWIFE_SURORIENTE: housewifeSuroriente,
  TOURIST: tourist,
  NIGHTLIFE_ATTENDEE: nightlifeAttendee,
};

/**
 * Distribution used when spawning N agents. Numbers sum to ~1.
 * Matches the brief's notion of a real BAQ commute mix:
 *   - Students dominate morning rush
 *   - Vendors keep midday lively
 *   - Executives mid-volume
 *   - Housewives spread out
 *   - Tourists are a small but talkative minority
 *   - Nightlife is rare but visually distinct on the late feed
 */
export const PROFILE_MIX: { profile: AgentProfile; weight: number }[] = [
  { profile: 'STUDENT_UNINORTE', weight: 0.3 },
  { profile: 'STREET_VENDOR', weight: 0.2 },
  { profile: 'EXECUTIVE_NORTE', weight: 0.2 },
  { profile: 'HOUSEWIFE_SURORIENTE', weight: 0.18 },
  { profile: 'TOURIST', weight: 0.07 },
  { profile: 'NIGHTLIFE_ATTENDEE', weight: 0.05 },
];
