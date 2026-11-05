// Live test against the real API. Prints shapes and counts only.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({ command: "node", args: ["dist/index.js"], env: process.env, stderr: "inherit" });
const client = new Client({ name: "smoke", version: "0" });
await client.connect(transport);

const shape = (v) =>
  Array.isArray(v) ? `array(${v.length})` : v && typeof v === "object" ? `{${Object.keys(v).join(",")}}` : typeof v;

async function call(name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content[0].text;
  if (res.isError) {
    console.log(`✗ ${name}: ${text}`);
    return undefined;
  }
  const data = JSON.parse(text);
  console.log(`✓ ${name}: ${shape(data)}${data?.state ? ` state=${data.state} size=${data.sizeBytes ?? "-"} inline=${"data" in data} summary=${JSON.stringify(Object.fromEntries(Object.entries(data.summary ?? {}).filter(([, v]) => typeof v !== "object")))}` : ""}`);
  return data;
}

const { tools } = await client.listTools();
console.log("tools:", tools.map((t) => t.name).join(", "));

const today = new Date().toISOString().slice(0, 10);
const monthAgo = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
const twoYearsAgo = new Date(Date.now() - 730 * 864e5).toISOString().slice(0, 10);

const issuers = await call("list_issuers");
const issuerId = issuers[0].id;
const securities = await call("list_securities", { issuerId });
const securityIds = securities.map((s) => s.id);

const prices = await call("get_daily_prices", { issuerId, securityId: securityIds[0], pageSize: 5 });
console.log("  page:", JSON.stringify(prices?.page));
const top = await call("get_top_holders", { issuerId, securityIds, noOfHolders: 3 });
console.log("  holders:", top?.holders?.length);
const dists = await call("list_distributions", { issuerId, fromRecordDate: twoYearsAgo, toRecordDate: today });
if (dists?.length) {
  await call("get_distribution_payment_list", { issuerId, distributionId: dists.at(-1).id });
}
await call("build_registration_details", {
  names: [{ title: "MR", name: "John Citizen" }],
  designation: "<CITIZEN FAMILY A/C>",
  address: { type: "australian", addressLine1: "1 Test St", suburb: "Sydney", state: "NSW", postcode: "2000" },
});
await call("run_transaction_listing_report", { issuerId, securityIds, fromDate: monthAgo, toDate: today });
await call("run_fund_cash_flow_report", { issuerId, fromTradeDate: monthAgo, toTradeDate: today });
const reg = await call("run_register_listing_report", { issuerId, securityIds: [securityIds[0]] });
if (reg?.reportId) await call("get_report", { issuerId, reportId: reg.reportId, waitSeconds: 0 });

await client.close();
