import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type FeedEventType =
  | 'trip_started'
  | 'trip_completed'
  | 'trip_cancelled'
  | 'incident_reported'
  | 'assistant_question'
  | 'rating_given'
  | 'favorite_saved'
  | 'agent_action';

export interface FeedEvent {
  id: string;
  type: FeedEventType;
  occurred_at: Date;
  actor_name: string | null;
  payload: Record<string, unknown>;
}

interface UnifiedFeedRow {
  id: string;
  type: FeedEventType;
  occurred_at: Date;
  actor_name: string | null;
  payload: Record<string, unknown>;
}

@Injectable()
export class FeedService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Unified feed across trips, incidents, assistant messages, ratings,
   * favorites and simulator events. Newest first.
   *
   * Single query with UNION ALL — fast even on large tables thanks to indexes
   * on created_at / occurred_at.
   */
  async list(params: {
    limit: number;
    since?: Date;
  }): Promise<{ events: FeedEvent[] }> {
    const sinceClause = (col: string) =>
      params.since ? `AND ${col} > $2::timestamptz` : '';

    const sql = `
      SELECT * FROM (
        -- Trips
        SELECT
          ('trip-' || t.id::text) AS id,
          CASE t.status::text
            WHEN 'IN_PROGRESS' THEN 'trip_started'
            WHEN 'COMPLETED' THEN 'trip_completed'
            WHEN 'CANCELLED' THEN 'trip_cancelled'
          END AS type,
          COALESCE(t.ended_at, t.started_at) AS occurred_at,
          p.name AS actor_name,
          jsonb_build_object(
            'trip_id', t.id::text,
            'route_id', t.route_id::text,
            'route_code', r.code,
            'status', t.status::text
          ) AS payload
        FROM trips t
        JOIN routes r ON r.id = t.route_id
        LEFT JOIN profiles p ON p.id = t.user_id
        WHERE 1=1 ${sinceClause('COALESCE(t.ended_at, t.started_at)')}

        UNION ALL

        -- Incidents
        SELECT
          ('inc-' || i.id::text),
          'incident_reported',
          i.reported_at,
          p.name,
          jsonb_build_object(
            'incident_id', i.id::text,
            'incident_type', i.type::text,
            'route_code', r.code,
            'lat', ST_Y(i.location::geometry),
            'lng', ST_X(i.location::geometry)
          )
        FROM incidents i
        LEFT JOIN routes r ON r.id = i.route_id
        LEFT JOIN profiles p ON p.id = i.user_id
        WHERE 1=1 ${sinceClause('i.reported_at')}

        UNION ALL

        -- Assistant questions
        SELECT
          ('ai-' || am.id::text),
          'assistant_question',
          am.created_at,
          p.name,
          jsonb_build_object(
            'question', am.question,
            'latency_ms', am.latency_ms
          )
        FROM assistant_messages am
        LEFT JOIN profiles p ON p.id = am.user_id
        WHERE 1=1 ${sinceClause('am.created_at')}

        UNION ALL

        -- Ratings
        SELECT
          ('rat-' || rt.id::text),
          'rating_given',
          rt.created_at,
          p.name,
          jsonb_build_object(
            'rating_id', rt.id::text,
            'stars', rt.stars,
            'comment', rt.comment
          )
        FROM ratings rt
        LEFT JOIN profiles p ON p.id = rt.user_id
        WHERE 1=1 ${sinceClause('rt.created_at')}

        UNION ALL

        -- Favorites
        SELECT
          ('fav-' || f.id::text),
          'favorite_saved',
          f.created_at,
          p.name,
          jsonb_build_object(
            'target_type', f.target_type::text,
            'alias', f.alias
          )
        FROM favorites f
        LEFT JOIN profiles p ON p.id = f.user_id
        WHERE 1=1 ${sinceClause('f.created_at')}

        UNION ALL

        -- Simulator events (will populate in Bloque 6)
        SELECT
          ('sim-' || se.id::text),
          'agent_action',
          se.occurred_at,
          sa.name,
          jsonb_build_object(
            'agent_id', sa.id::text,
            'profile', sa.profile_type::text,
            'action', se.action_type,
            'data', se.payload
          )
        FROM simulator_events se
        JOIN simulator_agents sa ON sa.id = se.agent_id
        WHERE 1=1 ${sinceClause('se.occurred_at')}
      ) AS unified
      ORDER BY occurred_at DESC
      LIMIT $1;
    `;

    const rows = params.since
      ? await this.prisma.$queryRawUnsafe<UnifiedFeedRow[]>(sql, params.limit, params.since)
      : await this.prisma.$queryRawUnsafe<UnifiedFeedRow[]>(sql, params.limit);

    return { events: rows };
  }
}
