import { TokenManager } from "./auth.js";
import type { Config } from "./config.js";
import { AutomicApiError, parseErrorBody } from "./errors.js";

export type QueryValue = string | number | boolean | Array<string | number> | undefined | null;
export type Query = Record<string, QueryValue>;

// Automic expects arrays comma-separated: securityIds=1444,1555
export function buildQuery(query: Query = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length > 0) params.set(key, value.join(","));
    } else {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export class AutomicClient {
  readonly tokens: TokenManager;

  constructor(
    readonly config: Config,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.tokens = new TokenManager(config, fetchImpl);
  }

  get<T>(path: string, query?: Query): Promise<T> {
    return this.request<T>("GET", path, query);
  }

  post<T>(path: string, query?: Query, body?: unknown): Promise<T> {
    return this.request<T>("POST", path, query, body);
  }

  private async request<T>(method: string, path: string, query?: Query, body?: unknown): Promise<T> {
    const url = `${this.config.baseUrl}${path}${buildQuery(query)}`;
    const send = async () => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${await this.tokens.getToken()}`,
        "X-API-Key": this.config.apiKey,
        Accept: "application/json",
      };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      return this.fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    };

    let res = await send();
    if (res.status === 401) {
      this.tokens.invalidate();
      res = await send();
    }
    if (!res.ok) {
      throw new AutomicApiError(res.status, `${method} ${path}`, parseErrorBody(await res.text()));
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }
}
