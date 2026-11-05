import fs from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";
import { AutomicClient } from "../src/client.js";
import { INLINE_LIMIT_BYTES, requestReport, summarise, waitForReport } from "../src/reports.js";
import { json, mockFetch, testConfig } from "./helpers.js";

const config = testConfig();
afterAll(() => fs.rm(config.reportDir, { recursive: true, force: true }));

const status = (s: string, extra: object = {}) =>
  json({
    reportStatus: {
      reportId: 77,
      issuerId: 1,
      status: s,
      error: s === "ERROR",
      inProgress: s === "PROCESSING",
      ready: s === "COMPLETE",
      ...extra,
    },
  });

const noSleep = async () => {};

describe("requestReport", () => {
  it("POSTs params in the query string and reads the report ID", async () => {
    const fetchImpl = mockFetch(() => json({ issuerId: 1, reportId: 77, links: [] }));
    const client = new AutomicClient(config, fetchImpl);
    await expect(
      requestReport(client, 1, "register-listing/v5", { securityIds: [10, 11], holderTypes: ["Company"] }),
    ).resolves.toBe(77);
    const [url, init] = fetchImpl.mock.calls[1]!;
    expect(init!.method).toBe("POST");
    expect(String(url)).toBe(
      "https://automic.test/api/report/async/register-listing/v5/issuer/1?securityIds=10%2C11&holderTypes=Company",
    );
  });

  it("falls back to the status link when reportId is null", async () => {
    const fetchImpl = mockFetch(() =>
      json({
        issuerId: 1,
        reportId: null,
        links: [{ rel: "status", href: "https://automic.test/api/report/async/v1/issuer/1/report/88/status" }],
      }),
    );
    await expect(requestReport(new AutomicClient(config, fetchImpl), 1, "x/v1", {})).resolves.toBe(88);
  });
});

describe("waitForReport", () => {
  it("polls until ready, then downloads and saves the report", async () => {
    const statuses = ["NEW", "PROCESSING", "COMPLETE"];
    const fetchImpl = mockFetch((url) =>
      url.pathname.endsWith("/status")
        ? status(statuses.shift()!, { reportName: "Register Listing" })
        : json({ asOfDate: "2026-11-05", holders: [{ holderId: 1 }, { holderId: 2 }] }),
    );
    const outcome = await waitForReport(new AutomicClient(config, fetchImpl), 1, 77, { sleep: noSleep });

    expect(outcome.state).toBe("ready");
    if (outcome.state !== "ready") return;
    expect(outcome.summary).toEqual({ asOfDate: "2026-11-05", holders: "2 items" });
    expect(outcome.data).toBeDefined();
    const saved = JSON.parse(await fs.readFile(outcome.savedTo, "utf8"));
    expect(saved.holders).toHaveLength(2);
    expect((await fs.stat(outcome.savedTo)).mode & 0o777).toBe(0o600);
  });

  it("omits inline data for large reports", async () => {
    const holders = Array.from({ length: 2000 }, (_, i) => ({ holderId: i, name: "x".repeat(40) }));
    const fetchImpl = mockFetch((url) => (url.pathname.endsWith("/status") ? status("COMPLETE") : json({ holders })));
    const outcome = await waitForReport(new AutomicClient(config, fetchImpl), 1, 77, { sleep: noSleep });
    expect(outcome.state === "ready" && outcome.sizeBytes > INLINE_LIMIT_BYTES).toBe(true);
    expect(outcome.state === "ready" && outcome.data).toBeFalsy();
  });

  it("returns pending with the reportId on timeout", async () => {
    const fetchImpl = mockFetch(() => status("PROCESSING"));
    const outcome = await waitForReport(new AutomicClient(config, fetchImpl), 1, 77, {
      timeoutMs: 0,
      sleep: noSleep,
    });
    expect(outcome).toMatchObject({ state: "pending", reportId: 77, status: "PROCESSING" });
  });

  it("surfaces report errors", async () => {
    const fetchImpl = mockFetch(() => status("ERROR", { errorMessage: "Bad security" }));
    const outcome = await waitForReport(new AutomicClient(config, fetchImpl), 1, 77, { sleep: noSleep });
    expect(outcome).toMatchObject({ state: "error", message: "Bad security" });
  });
});

describe("summarise", () => {
  it("replaces arrays with counts, recursively", () => {
    expect(summarise({ a: 1, list: [1, 2], nested: { rows: [1] } })).toEqual({
      a: 1,
      list: "2 items",
      nested: { rows: "1 items" },
    });
  });
});
