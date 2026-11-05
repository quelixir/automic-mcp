import os from "node:os";
import path from "node:path";
import { vi } from "vitest";
import type { Config } from "../src/config.js";

export const testConfig = (overrides: Partial<Config> = {}): Config => ({
  baseUrl: "https://automic.test",
  clientId: "client-id",
  clientSecret: "client-secret",
  apiKey: "api-key",
  reportDir: path.join(os.tmpdir(), `automic-mcp-test-${process.pid}`),
  ...overrides,
});

export function jwt(expSeconds: number): string {
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc({ alg: "HS256" })}.${enc({ exp: expSeconds, iat: expSeconds - 1800 })}.sig`;
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

type Route = (url: URL, init: RequestInit) => Response | Promise<Response>;

export function mockFetch(route: Route, token = jwt(Math.floor(Date.now() / 1000) + 1800)) {
  return vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/oauth/token/v1/grant") {
      return json({ token_type: "Bearer", access_token: token, refresh_token: "r" });
    }
    return route(url, init);
  });
}
