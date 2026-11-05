import fs from "node:fs/promises";
import path from "node:path";
import type { AutomicClient, Query } from "./client.js";

interface Link {
  rel: string;
  href: string;
}

interface ReportRequestResponse {
  issuerId: number;
  reportId: number | null;
  links?: Link[];
}

export interface ReportStatus {
  reportId: number;
  requestedTimeUtc?: string;
  reportName?: string;
  format?: string;
  issuerId: number;
  status: string;
  errorMessage?: string | null;
  error: boolean;
  inProgress: boolean;
  ready: boolean;
}

export interface WaitOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export type ReportOutcome =
  | {
      state: "ready";
      reportId: number;
      reportName?: string;
    } & SavedResult
  | { state: "pending"; reportId: number; status: string; message: string }
  | { state: "error"; reportId: number; status: string; message: string };

export const INLINE_LIMIT_BYTES = 50_000;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Some documented responses have reportId: null; the status link still carries it.
function extractReportId(res: ReportRequestResponse): number {
  if (typeof res.reportId === "number") return res.reportId;
  for (const link of res.links ?? []) {
    const match = /\/report\/(\d+)\//.exec(link.href);
    if (match) return Number(match[1]);
  }
  throw new Error("Automic did not return a report ID for the report request");
}

export function summarise(data: unknown): Record<string, unknown> {
  if (Array.isArray(data)) return { rows: data.length };
  if (!data || typeof data !== "object") return { value: data };
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) out[key] = `${value.length} items`;
    else if (value && typeof value === "object") out[key] = summarise(value);
    else out[key] = value;
  }
  return out;
}

export async function requestReport(
  client: AutomicClient,
  issuerId: number,
  reportPath: string,
  query: Query,
): Promise<number> {
  const res = await client.post<ReportRequestResponse>(
    `/api/report/async/${reportPath}/issuer/${issuerId}`,
    query,
  );
  return extractReportId(res);
}

export async function getReportStatus(
  client: AutomicClient,
  issuerId: number,
  reportId: number,
): Promise<ReportStatus> {
  const res = await client.get<{ reportStatus: ReportStatus }>(
    `/api/report/async/v1/issuer/${issuerId}/report/${reportId}/status`,
  );
  return res.reportStatus;
}

export async function waitForReport(
  client: AutomicClient,
  issuerId: number,
  reportId: number,
  opts: WaitOptions = {},
): Promise<ReportOutcome> {
  const { timeoutMs = 90_000, pollIntervalMs = 3_000, sleep = defaultSleep } = opts;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const status = await getReportStatus(client, issuerId, reportId);
    if (status.error || status.status === "ERROR") {
      return {
        state: "error",
        reportId,
        status: status.status,
        message: status.errorMessage || "Automic reported an error generating this report.",
      };
    }
    if (status.ready) return downloadReport(client, issuerId, reportId, status.reportName);
    if (Date.now() + pollIntervalMs > deadline) {
      return {
        state: "pending",
        reportId,
        status: status.status,
        message: `Report ${reportId} is still ${status.status}. Call get_report with this reportId to check again.`,
      };
    }
    await sleep(pollIntervalMs);
  }
}

export interface SavedResult {
  savedTo: string;
  sizeBytes: number;
  summary: Record<string, unknown>;
  data?: unknown;
}

export async function saveResult(dir: string, fileName: string, data: unknown): Promise<SavedResult> {
  const json = JSON.stringify(data, null, 2);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const savedTo = path.join(dir, fileName);
  await fs.writeFile(savedTo, json, { mode: 0o600 });
  const sizeBytes = Buffer.byteLength(json);
  return {
    savedTo,
    sizeBytes,
    summary: summarise(data),
    ...(sizeBytes <= INLINE_LIMIT_BYTES ? { data } : {}),
  };
}

async function downloadReport(
  client: AutomicClient,
  issuerId: number,
  reportId: number,
  reportName?: string,
): Promise<ReportOutcome> {
  const data = await client.get<unknown>(
    `/api/report/async/v1/issuer/${issuerId}/report/${reportId}/download`,
  );
  const saved = await saveResult(client.config.reportDir, `issuer-${issuerId}-report-${reportId}.json`, data);
  return { state: "ready", reportId, reportName, ...saved };
}
