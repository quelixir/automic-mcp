#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AutomicClient } from "./client.js";
import { loadConfig } from "./config.js";
import { registerTools } from "./tools.js";

async function main() {
  const config = loadConfig();
  const server = new McpServer(
    { name: "automic", version: "0.1.0" },
    {
      instructions:
        "Read-only Automic registry access. Use list_issuers and list_securities to find IDs. Some results contain investor personal data.",
    },
  );
  registerTools(server, new AutomicClient(config));
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
