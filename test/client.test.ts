import { describe, expect, it } from "vitest";
import { TokenManager } from "../src/auth.js";
import { AutomicClient, buildQuery } from "../src/client.js";
import { loadConfig, normaliseBaseUrl } from "../src/config.js";
import { json, jwt, mockFetch, testConfig } from "./helpers.js";

describe("config", () => {
  it("strips trailing slashes and /api from the base URL", () => {
    expect(normaliseBaseUrl("https://api.automic.com.au/api/")).toBe("https://api.automic.com.au");
    expect(normaliseBaseUrl("https://api.automic.com.au")).toBe("https://api.automic.com.au");
  });

  it("reports every missing credential", () => {
    expect(() => loadConfig({})).toThrow(/AUTOMIC_CLIENT_ID, AUTOMIC_CLIENT_SECRET, AUTOMIC_API_KEY/);
  });
});

describe("buildQuery", () => {
  it("joins arrays with commas and drops empty values", () => {
    expect(buildQuery({ securityIds: [1444, 1555], asOfDate: undefined, flag: false, empty: [] })).toBe(
      "?securityIds=1444%2C1555&flag=false",
    );
  });
});

describe("TokenManager", () => {
  it("sends Basic auth and the API key, and caches the token until near expiry", async () => {
    let now = 1_000_000_000_000;
    const fetchImpl = mockFetch(() => json({}), jwt(now / 1000 + 1800));
    const tokens = new TokenManager(testConfig(), fetchImpl, () => now);

    await tokens.getToken();
    await tokens.getToken();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const headers = fetchImpl.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("client-id:client-secret").toString("base64")}`);
    expect(headers["X-API-Key"]).toBe("api-key");

    now += 29 * 60 * 1000;
    await tokens.getToken();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("shares one grant between concurrent callers", async () => {
    const fetchImpl = mockFetch(() => json({}));
    const tokens = new TokenManager(testConfig(), fetchImpl);
    await Promise.all([tokens.getToken(), tokens.getToken(), tokens.getToken()]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("AutomicClient", () => {
  it("sends bearer token and API key", async () => {
    const fetchImpl = mockFetch(() => json([{ id: 1 }]));
    const client = new AutomicClient(testConfig(), fetchImpl);
    await expect(client.get("/api/issuer/v1")).resolves.toEqual([{ id: 1 }]);
    const headers = fetchImpl.mock.calls[1]![1]!.headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^Bearer /);
    expect(headers["X-API-Key"]).toBe("api-key");
  });

  it("re-grants and retries once on 401", async () => {
    let calls = 0;
    const fetchImpl = mockFetch(() => (++calls === 1 ? json({ error: "expired" }, 401) : json({ ok: true })));
    const client = new AutomicClient(testConfig(), fetchImpl);
    await expect(client.get("/api/issuer/v1")).resolves.toEqual({ ok: true });
    const grants = fetchImpl.mock.calls.filter(([u]) => String(u).includes("/oauth/"));
    expect(grants).toHaveLength(2);
  });

  it("turns error responses into readable errors", async () => {
    const fetchImpl = mockFetch(() => json({ status: 404, error: "Issuer not found" }, 404));
    const client = new AutomicClient(testConfig(), fetchImpl);
    await expect(client.get("/api/security/v1/issuer/9")).rejects.toThrow(
      /HTTP 404\).*Not found.*Issuer not found/,
    );
  });
});
