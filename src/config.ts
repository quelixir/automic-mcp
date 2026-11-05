import os from "node:os";
import path from "node:path";

export interface Config {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  apiKey: string;
  reportDir: string;
}

export const DEFAULT_BASE_URL = "https://api.automic.com.au";

export function normaliseBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "").replace(/\/api$/, "");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const missing = ["AUTOMIC_CLIENT_ID", "AUTOMIC_CLIENT_SECRET", "AUTOMIC_API_KEY"].filter(
    (name) => !env[name]?.trim(),
  );
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
  return {
    baseUrl: normaliseBaseUrl(env.AUTOMIC_BASE_URL || DEFAULT_BASE_URL),
    clientId: env.AUTOMIC_CLIENT_ID!.trim(),
    clientSecret: env.AUTOMIC_CLIENT_SECRET!.trim(),
    apiKey: env.AUTOMIC_API_KEY!.trim(),
    reportDir: env.AUTOMIC_REPORT_DIR || path.join(os.tmpdir(), "automic-mcp-reports"),
  };
}
