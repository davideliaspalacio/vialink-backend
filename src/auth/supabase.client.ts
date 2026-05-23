import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AppConfig } from '../config/configuration';

/**
 * Two Supabase clients:
 *   - `admin`: uses service_role key. Bypasses RLS. For backend ops
 *     (createUser, getUser, etc.).
 *   - `anon`:  uses publishable/anon key. For user-scoped operations
 *     (signInWithPassword). Falls back to service_role if anon key
 *     looks like a placeholder.
 */
@Injectable()
export class SupabaseClientFactory implements OnModuleInit {
  private readonly logger = new Logger(SupabaseClientFactory.name);

  readonly admin: SupabaseClient;
  readonly anon: SupabaseClient;

  constructor(config: ConfigService<AppConfig, true>) {
    const url = config.get('SUPABASE_URL', { infer: true });
    const serviceKey = config.get('SUPABASE_SERVICE_ROLE_KEY', { infer: true });
    const anonKey = config.get('SUPABASE_ANON_KEY', { infer: true });

    this.admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // If the anon key is a placeholder, use the service role as fallback
    // so signInWithPassword still works. Warn loud so it's noticed.
    const looksLikePlaceholder =
      !anonKey ||
      anonKey.includes('PLACEHOLDER') ||
      anonKey.includes('placeholder') ||
      anonKey.length < 40;
    const startsWithExpectedPrefix =
      anonKey?.startsWith('sb_publishable_') || anonKey?.startsWith('eyJ');
    const looksReal = !looksLikePlaceholder && startsWithExpectedPrefix;
    const effectiveAnon = looksReal ? anonKey : serviceKey;
    if (!looksReal) {
      // Logger isn't ready in constructor — will warn in onModuleInit
    }
    this.anon = createClient(url, effectiveAnon, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    (this as { _usingFallbackAnon?: boolean })._usingFallbackAnon = !looksReal;
  }

  onModuleInit() {
    if ((this as { _usingFallbackAnon?: boolean })._usingFallbackAnon) {
      this.logger.warn(
        '⚠️ SUPABASE_ANON_KEY is a placeholder. Falling back to service_role for client ops. ' +
          'Replace with the real publishable key from the dashboard for proper security separation.',
      );
    } else {
      this.logger.log('✅ Supabase clients ready (admin + anon)');
    }
  }
}
