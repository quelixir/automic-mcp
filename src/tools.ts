import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { AutomicClient } from "./client.js";
import { requestReport, saveResult, waitForReport } from "./reports.js";

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .describe("Date in YYYY-MM-DD format");
const issuerId = z.number().int().positive().describe("Issuer ID (from list_issuers)");
const securityIds = z
  .array(z.number().int().positive())
  .min(1)
  .describe("Security IDs (from list_securities)");
const waitSeconds = z
  .number()
  .int()
  .min(0)
  .max(300)
  .default(90)
  .describe("Seconds to wait before returning a pending reportId");

const HOLDER_TYPES = ["Company", "JointCompany", "Individual", "JointIndividual"] as const;
const PRICE_NAMES = [
  "NAV",
  "NAVEX",
  "Application",
  "Redemption",
  "Open",
  "Close",
  "High",
  "Low",
  "ESP",
] as const;

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: true } as const;

const PII_NOTE = "Contains investor personal data.";

function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

function safe<A>(fn: (args: A) => Promise<unknown>): (args: A) => Promise<CallToolResult> {
  return async (args) => {
    try {
      return ok(await fn(args));
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
      };
    }
  };
}

export function registerTools(server: McpServer, client: AutomicClient): void {
  server.registerTool(
    "list_issuers",
    {
      title: "List issuers",
      description: "List issuers this API app can access.",
      annotations: READ_ONLY,
    },
    safe(() => client.get("/api/issuer/v1")),
  );

  server.registerTool(
    "list_securities",
    {
      title: "List securities",
      description:
        "List an issuer's securities with holder counts and issued capital.",
      inputSchema: { issuerId },
      annotations: READ_ONLY,
    },
    safe(({ issuerId }) => client.get(`/api/security/v1/issuer/${issuerId}`)),
  );

  server.registerTool(
    "get_daily_prices",
    {
      title: "Get daily prices",
      description:
        "Daily prices (OHLC, volume, NAV, application/redemption) for a security. Max 20 per page.",
      inputSchema: {
        issuerId,
        securityId: z.number().int().positive().describe("Security ID"),
        fromDate: date.optional(),
        toDate: date.optional().describe("End date, YYYY-MM-DD (default today)"),
        pageNumber: z.number().int().min(0).optional().describe("Zero-based page number (default 0)"),
        pageSize: z.number().int().min(1).max(20).optional().describe("Results per page, 1-20 (default 20)"),
      },
      annotations: READ_ONLY,
    },
    safe(({ issuerId, securityId, ...query }) =>
      client.get(`/api/daily-price/v1/issuer/${issuerId}/security/${securityId}`, query),
    ),
  );

  server.registerTool(
    "get_top_holders",
    {
      title: "Get top holders",
      description:
        "Top holders of securities as of a date. Max 50. Holder numbers are masked without the 'view holder number' permission.",
      inputSchema: {
        issuerId,
        securityIds,
        noOfHolders: z.number().int().min(1).max(50).optional().describe("Number of holders, 1-50 (default 20)"),
        showHolderNumber: z.boolean().optional(),
        includeHolderGroup: z.boolean().optional().describe("Aggregate holders into holder groups"),
        showGroupMembers: z.boolean().optional().describe("List members of each holder group"),
        asOfDate: date.optional().describe("As-of date, YYYY-MM-DD (default today)"),
      },
      annotations: READ_ONLY,
    },
    safe(({ issuerId, ...query }) => client.get(`/api/report/top-holders/v1/issuer/${issuerId}`, query)),
  );

  server.registerTool(
    "list_distributions",
    {
      title: "List distributions",
      description:
        "Approved distributions in a record-date range, with dates, DRP details and components.",
      inputSchema: {
        issuerId,
        fromRecordDate: date.describe("Start of record-date range, YYYY-MM-DD"),
        toRecordDate: date.describe("End of record-date range, YYYY-MM-DD"),
      },
      annotations: READ_ONLY,
    },
    safe(({ issuerId, ...query }) => client.get(`/api/distributions/v2/issuer/${issuerId}`, query)),
  );

  server.registerTool(
    "get_distribution_payment_list",
    {
      title: "Get distribution payment list",
      description:
        "Per-holder payments for a distribution: components, tax, DRP, net amount, payment method. Saved to a JSON file; returned inline if small. " +
        PII_NOTE,
      inputSchema: {
        issuerId,
        distributionId: z.number().int().positive().describe("Distribution ID (from list_distributions)"),
      },
      annotations: READ_ONLY,
    },
    safe(async ({ issuerId, distributionId }) => {
      const data = await client.get(
        `/api/report/distributions-payment-list/v3/issuer/${issuerId}/distribution/${distributionId}`,
      );
      return saveResult(
        client.config.reportDir,
        `issuer-${issuerId}-distribution-${distributionId}-payments.json`,
        data,
      );
    }),
  );

  server.registerTool(
    "build_registration_details",
    {
      title: "Build registration details",
      description:
        "Format names, designation and address into a registration details string. Creates nothing.",
      inputSchema: {
        names: z
          .array(
            z.object({
              title: z.string().nullable().optional().describe("e.g. MR, MRS, DR"),
              name: z.string().nullable().optional().describe("Full name"),
            }),
          )
          .min(1),
        designation: z.string().nullable().optional().describe("Account designation, e.g. <SMITH FAMILY A/C>"),
        address: z.object({
          type: z.enum(["australian", "overseas"]),
          addressLine1: z.string().nullable().optional(),
          addressLine2: z.string().nullable().optional(),
          suburb: z.string().nullable().optional().describe("Australian addresses"),
          state: z.string().nullable().optional(),
          postcode: z.string().nullable().optional().describe("Required for Australian addresses"),
          city: z.string().nullable().optional().describe("Overseas addresses"),
          country: z.string().nullable().optional().describe("Overseas addresses"),
          isoCode: z.string().nullable().optional().describe("3-letter ISO country code; required for overseas"),
        }),
        namesOnSameLine: z.boolean().optional(),
      },
      annotations: { ...READ_ONLY, idempotentHint: true },
    },
    safe((body) => client.post("/api/applications/v1/buildregodetails", undefined, body)),
  );

  server.registerTool(
    "run_register_listing_report",
    {
      title: "Run register listing report",
      description:
        "Register listing for securities as of a date. Async: waits up to waitSeconds, else returns a reportId for get_report. Saved to a JSON file; returned inline if small. " +
        PII_NOTE,
      inputSchema: {
        issuerId,
        securityIds,
        holderTypes: z.array(z.enum(HOLDER_TYPES)).min(1).default([...HOLDER_TYPES]),
        asOfDate: date.optional().describe("As-of date, YYYY-MM-DD (default today)"),
        countryCodes: z.array(z.string().length(3)).optional().describe("ISO alpha-3 country codes, e.g. AUS"),
        minimumHolding: z.number().min(0).optional().describe("Default 1"),
        maximumHolding: z.number().min(0).optional(),
        minimumPostcode: z.number().int().optional(),
        maximumPostcode: z.number().int().optional(),
        priceName: z.enum(PRICE_NAMES).optional().describe("Price used to value balances"),
        waitSeconds,
      },
      annotations: READ_ONLY,
    },
    safe(async ({ issuerId, waitSeconds, ...query }) => {
      const reportId = await requestReport(client, issuerId, "register-listing/v5", query);
      return waitForReport(client, issuerId, reportId, { timeoutMs: waitSeconds * 1000 });
    }),
  );

  server.registerTool(
    "run_transaction_listing_report",
    {
      title: "Run transaction listing report",
      description:
        "Holding movements for securities over a date range. Async, same as run_register_listing_report.",
      inputSchema: {
        issuerId,
        securityIds,
        fromDate: date,
        toDate: date,
        movementTypes: z
          .array(z.string())
          .optional()
          .describe(
            "Filter by movement type, e.g. Application, Redemption, Transfer, TransferIn, TransferOut, Reinvestment, MarketMovement, IssuerToChessTransfer, ChessToIssuerTransfer, Adjustment, Cancellation, Buyback. Omit for all.",
          ),
        minThreshold: z.number().min(0).optional().describe("Minimum movement size (default 0)"),
        includeHolderNumber: z.boolean().optional(),
        waitSeconds,
      },
      annotations: READ_ONLY,
    },
    safe(async ({ issuerId, waitSeconds, ...query }) => {
      const reportId = await requestReport(client, issuerId, "transaction-listing/v1", query);
      return waitForReport(client, issuerId, reportId, { timeoutMs: waitSeconds * 1000 });
    }),
  );

  server.registerTool(
    "run_fund_cash_flow_report",
    {
      title: "Run fund cash flow report",
      description:
        "Fund applications and redemptions with pending and completed totals. Async, same as run_register_listing_report.",
      inputSchema: {
        issuerId,
        searchByTradeDate: z
          .boolean()
          .default(true)
          .describe("true: filter by trade date (from/toTradeDate); false: by order date-time"),
        fromTradeDate: date.optional(),
        toTradeDate: date.optional(),
        fromOrderDateTime: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/, "Use yyyy-MM-ddTHH:mm:ss")
          .optional(),
        toOrderDateTime: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/, "Use yyyy-MM-ddTHH:mm:ss")
          .optional(),
        tradeType: z.enum(["Application", "Redemption", "All"]).optional().describe("Default All"),
        orderStatuses: z
          .array(z.enum(["Pending", "PendingConfirmed", "Completed"]))
          .optional()
          .describe("Pending is only valid when searchByTradeDate is false"),
        includeVerificationDetails: z.boolean().default(false),
        includeInvestorDetails: z.boolean().default(false),
        waitSeconds,
      },
      annotations: READ_ONLY,
    },
    safe(async ({ issuerId, waitSeconds, ...query }) => {
      const reportId = await requestReport(client, issuerId, "fund-cash-flow/v5", query);
      return waitForReport(client, issuerId, reportId, { timeoutMs: waitSeconds * 1000 });
    }),
  );

  server.registerTool(
    "get_report",
    {
      title: "Get report",
      description:
        "Check status of an async report and download it when ready.",
      inputSchema: {
        issuerId,
        reportId: z.number().int().positive(),
        waitSeconds: waitSeconds.default(30),
      },
      annotations: { ...READ_ONLY, idempotentHint: true },
    },
    safe(({ issuerId, reportId, waitSeconds }) =>
      waitForReport(client, issuerId, reportId, { timeoutMs: waitSeconds * 1000 }),
    ),
  );
}
