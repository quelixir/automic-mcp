import type { Config } from "./config.js";
import { AutomicApiError, parseErrorBody } from "./errors.js";

interface TokenResponse {
  token_type: string;
  access_token: string;
  refresh_token?: string;
}

const DEFAULT_LIFETIME_MS = 30 * 60 * 1000;
const EXPIRY_MARGIN_MS = 2 * 60 * 1000;

function jwtExpiryMs(token: string): number | undefined {
  const payload = token.split(".")[1];
  if (!payload) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof claims.exp === "number" ? claims.exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}

export class TokenManager {
  private token?: string;
  private expiresAt = 0;
  private pending?: Promise<string>;

  constructor(
    private readonly config: Config,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async getToken(): Promise<string> {
    if (this.token && this.now() < this.expiresAt - EXPIRY_MARGIN_MS) return this.token;
    this.pending ??= this.grant().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  invalidate(): void {
    this.token = undefined;
    this.expiresAt = 0;
  }

  private async grant(): Promise<string> {
    const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64");
    const res = await this.fetchImpl(
      `${this.config.baseUrl}/api/oauth/token/v1/grant?grant_type=client_credentials`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "X-API-Key": this.config.apiKey,
          Accept: "application/json",
        },
      },
    );
    if (!res.ok) {
      throw new AutomicApiError(res.status, "token grant", parseErrorBody(await res.text()));
    }
    const body = (await res.json()) as TokenResponse;
    if (!body.access_token) throw new Error("Automic token grant returned no access_token");
    this.token = body.access_token;
    this.expiresAt = jwtExpiryMs(body.access_token) ?? this.now() + DEFAULT_LIFETIME_MS;
    return this.token;
  }
}
