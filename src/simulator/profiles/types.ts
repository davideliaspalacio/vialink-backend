/**
 * Vialink Simulator — agent profile types.
 *
 * A "profile" defines how a class of agents behaves: what hours they're
 * active, where they typically go, and what actions they take in each
 * state. The profile is data, not code (so it's easy to tune without
 * recompiling).
 */

import type { AgentProfile } from '@prisma/client';
import type { LatLng } from '../../common/types/geo';

/** Anchor points an agent typically moves between during the day. */
export interface ProfileAnchor {
  /** Friendly name shown in feed events ("Universidad del Norte"). */
  name: string;
  location: LatLng;
}

/** Probability weights for picking actions in a given state. */
export interface ActionWeights {
  /** Probability the agent asks the AI assistant a question this tick. */
  askAi?: number;
  /** Probability the agent reports an incident this tick (only WAITING_BUS / ON_BUS). */
  reportIncident?: number;
  /** Probability the agent saves a landmark as favorite (only AT_DESTINATION). */
  saveFavorite?: number;
  /** Probability the agent rates the trip 4-5★ (only AT_DESTINATION right after trip). */
  rateTrip?: number;
}

/** Hour-of-day window during which the profile is active. */
export interface ActiveHours {
  /** Hours 0-23 the agent is active and considers going somewhere. */
  active: number[];
  /** Hours 0-23 the agent sleeps (forced IDLE, no actions). */
  asleep?: number[];
}

/**
 * Bank of preferred questions the agent can ask Claude.
 * Picked at random when askAi triggers and probability landed within
 * SIMULATOR_LLM_PROBABILITY (so even if askAi=0.3, only 10% by default
 * hit the real API; the rest are silent or use canned questions).
 */
export interface QuestionBank {
  /** Free-form questions the agent might ask. */
  questions: string[];
}

export interface ProfileBehavior {
  /** Maps 1:1 to Prisma enum AgentProfile. */
  key: AgentProfile;
  /** Human label shown in feed events. */
  label: string;
  /** Hours of activity. */
  hours: ActiveHours;
  /**
   * Resolve which destination the agent should head to from its home,
   * given the hour and a deterministic random hint (0..1). Should return
   * one of the anchor locations or null if the agent stays home.
   */
  pickDestination: (
    home: LatLng,
    work: LatLng | null,
    hour: number,
    rng: number,
  ) => ProfileAnchor | null;
  /** Probability weights per agent tick. */
  weights: ActionWeights;
  /** Question bank for askAi (used by ~10% of askAi events). */
  questionBank: QuestionBank;
  /** Likely walking-speed in km/h. Used by walking-paths.service. */
  walkingSpeedKmh: number;
  /** Spanish first names typical of BAQ, for friendly identification. */
  sampleNames: string[];
}

/**
 * Curated home/work zones for each profile. Real BAQ coords; sample is
 * jittered per agent so they don't all stand on top of each other.
 */
export interface ProfileSpawn {
  homeZones: { name: string; lat: number; lng: number }[];
  workZones?: { name: string; lat: number; lng: number }[];
}
