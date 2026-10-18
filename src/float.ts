// Minimal Float API v3 client: auth, required User-Agent, rate limiting and retries.
// Limits (developer.float.com): 200 GET/min and 100 non-GET/min per company, 4 non-GET/s burst.
const BASE = 'https://api.float.com/v3';
const WRITE_GAP_MS = 700; // ~85 writes/min, under the 100/min limit

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class FloatError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    readonly body: string,
  ) {
    super(`${method} ${path} -> ${status}: ${body.slice(0, 400)}`);
  }
}

export interface FloatResponse<T> {
  data: T;
  headers: Headers;
}

export function loadEnv(): { token: string; contact: string } {
  try {
    process.loadEnvFile('.env');
  } catch {
    // fall back to the shell environment
  }
  const token = process.env.FLOAT_API_TOKEN?.trim();
  const contact = process.env.FLOAT_CONTACT_EMAIL?.trim();
  if (!token || !contact) {
    console.error('Missing FLOAT_API_TOKEN or FLOAT_CONTACT_EMAIL. Copy .env.example to .env and fill both in.');
    process.exit(1);
  }
  return { token, contact };
}

export class FloatClient {
  private lastWrite = 0;
  calls = 0;

  constructor(
    private readonly token: string,
    private readonly contact: string,
  ) {}

  async request<T>(method: string, path: string, body?: unknown): Promise<FloatResponse<T>> {
    if (method !== 'GET') {
      const wait = this.lastWrite + WRITE_GAP_MS - Date.now();
      if (wait > 0) await sleep(wait);
    }
    for (let attempt = 0; attempt < 6; attempt++) {
      const res = await fetch(BASE + path, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': `float-nextgen seeder (${this.contact})`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      this.calls++;
      if (method !== 'GET') this.lastWrite = Date.now();
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('retry-after')) || 15;
        console.warn(`  rate limited, waiting ${retryAfter}s`);
        await sleep(retryAfter * 1000);
        continue;
      }
      // A 429 means Float rejected the call before processing it, so any method is safe to retry.
      // A 5xx on a write may already have been applied, so only GETs retry; writes surface the error
      // and the caller's manifest decides what to do.
      if (res.status >= 500 && method === 'GET') {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      const text = await res.text();
      if (!res.ok) throw new FloatError(res.status, method, path, text);
      return { data: (text ? JSON.parse(text) : null) as T, headers: res.headers };
    }
    throw new Error(`${method} ${path}: retries exhausted`);
  }

  get<T>(path: string) {
    return this.request<T>('GET', path);
  }
  post<T>(path: string, body: unknown) {
    return this.request<T>('POST', path, body);
  }
  patch<T>(path: string, body: unknown) {
    return this.request<T>('PATCH', path, body);
  }
  del(path: string) {
    return this.request<null>('DELETE', path);
  }

  async count(path: string): Promise<number> {
    const sep = path.includes('?') ? '&' : '?';
    const { headers, data } = await this.get<unknown[]>(`${path}${sep}per-page=1`);
    return Number(headers.get('x-pagination-total-count') ?? (Array.isArray(data) ? data.length : 0));
  }

  async all<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    const sep = path.includes('?') ? '&' : '?';
    for (let page = 1; ; page++) {
      const { data, headers } = await this.get<T[]>(`${path}${sep}per-page=200&page=${page}`);
      out.push(...data);
      const pageCount = headers.get('x-pagination-page-count');
      // Float documents this header on every list endpoint. Without it we cannot know the list is
      // complete, and a silent partial pull would corrupt everything downstream.
      if (pageCount === null) throw new Error(`GET ${path}: missing X-Pagination-Page-Count header, refusing a partial pull`);
      if (page >= Number(pageCount)) return out;
    }
  }
}
