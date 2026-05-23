import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { CitiesService } from '../cities/cities.service';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseClientFactory } from './supabase.client';

export interface AuthSession {
  access_token: string;
  refresh_token: string;
  user: {
    id: string;
    email: string;
    name: string | null;
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  // In-memory cache of access_token → user (TTL 60s) to avoid hammering Supabase
  private readonly tokenCache = new Map<
    string,
    { user: { id: string; email: string; name: string | null }; expiresAt: number }
  >();

  constructor(
    private readonly supabase: SupabaseClientFactory,
    private readonly prisma: PrismaService,
    private readonly cities: CitiesService,
  ) {}

  async signup(params: {
    email: string;
    password: string;
    name?: string;
    cityCode: string;
  }): Promise<AuthSession> {
    const cityId = await this.cities.getIdByCode(params.cityCode);

    // 1) Create user in Supabase Auth (admin endpoint, auto-confirms email)
    const { data: created, error: createErr } =
      await this.supabase.admin.auth.admin.createUser({
        email: params.email,
        password: params.password,
        email_confirm: true,
        user_metadata: { name: params.name ?? null },
      });
    if (createErr || !created.user) {
      throw new BadRequestException(createErr?.message ?? 'Could not create user');
    }
    const userId = created.user.id;

    // 2) Insert profile row in our public.profiles (idempotent by PK = auth.users.id)
    await this.prisma.$executeRawUnsafe(
      `
      INSERT INTO profiles (id, email, name, city_id, created_at)
      VALUES ($1::uuid, $2, $3, $4::uuid, NOW())
      ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name;
      `,
      userId,
      params.email,
      params.name ?? null,
      cityId,
    );

    // 3) Sign in to obtain access_token + refresh_token
    return this.login({ email: params.email, password: params.password });
  }

  async login(params: { email: string; password: string }): Promise<AuthSession> {
    const { data, error } = await this.supabase.anon.auth.signInWithPassword({
      email: params.email,
      password: params.password,
    });
    if (error || !data.session || !data.user) {
      throw new UnauthorizedException(error?.message ?? 'Invalid credentials');
    }
    const profile = await this.prisma.profile.findUnique({
      where: { id: data.user.id },
      select: { name: true },
    });
    return {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      user: {
        id: data.user.id,
        email: data.user.email!,
        name: profile?.name ?? (data.user.user_metadata?.name as string) ?? null,
      },
    };
  }

  async refresh(refreshToken: string): Promise<AuthSession> {
    const { data, error } = await this.supabase.anon.auth.refreshSession({
      refresh_token: refreshToken,
    });
    if (error || !data.session || !data.user) {
      throw new UnauthorizedException(error?.message ?? 'Invalid refresh token');
    }
    const profile = await this.prisma.profile.findUnique({
      where: { id: data.user.id },
      select: { name: true },
    });
    return {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      user: {
        id: data.user.id,
        email: data.user.email!,
        name: profile?.name ?? null,
      },
    };
  }

  /**
   * Verifies an access_token against Supabase Auth and returns the user.
   * Cached in-memory for 60s to avoid roundtripping per request.
   */
  async verifyAccessToken(
    token: string,
  ): Promise<{ id: string; email: string; name: string | null }> {
    const now = Date.now();
    const cached = this.tokenCache.get(token);
    if (cached && cached.expiresAt > now) {
      return cached.user;
    }

    const { data, error } = await this.supabase.admin.auth.getUser(token);
    if (error || !data.user) {
      throw new UnauthorizedException(error?.message ?? 'Invalid token');
    }

    const profile = await this.prisma.profile.findUnique({
      where: { id: data.user.id },
      select: { name: true },
    });

    const user = {
      id: data.user.id,
      email: data.user.email!,
      name: profile?.name ?? (data.user.user_metadata?.name as string) ?? null,
    };

    this.tokenCache.set(token, { user, expiresAt: now + 60_000 });

    // Light GC
    if (this.tokenCache.size > 500) {
      for (const [k, v] of this.tokenCache) {
        if (v.expiresAt <= now) this.tokenCache.delete(k);
      }
    }

    return user;
  }
}
