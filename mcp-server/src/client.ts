/**
 * HTTP client minimal contra el backend Vialink.
 *
 * No depende de axios/fetch wrappers para mantener el bundle del MCP
 * server lo más liviano posible. Solo wraps `fetch` nativo de Node 20+.
 *
 * URL base configurable vía env `VIALINK_API_URL`:
 *   - Local dev:  http://localhost:3000
 *   - Railway:    https://vialink-backend-production.up.railway.app
 */

const BASE_URL =
  process.env.VIALINK_API_URL?.replace(/\/$/, '') ?? 'http://localhost:3000';
const API_PREFIX = '/api/v1';

export class VialinkClient {
  constructor(private readonly baseUrl: string = BASE_URL) {}

  async get<T>(
    path: string,
    query?: Record<string, string | number | undefined>,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${API_PREFIX}${path}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }
    const res = await fetch(url.toString());
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `Vialink GET ${path} → ${res.status}: ${body.slice(0, 200)}`,
      );
    }
    return (await res.json()) as T;
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${API_PREFIX}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `Vialink POST ${path} → ${res.status}: ${text.slice(0, 200)}`,
      );
    }
    return (await res.json()) as T;
  }
}

export const client = new VialinkClient();
