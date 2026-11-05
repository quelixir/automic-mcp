# automic-mcp

Read-only MCP server for the [Automic Registry Platform API](https://developer.automic.com.au/).

## Setup

Create an app with Read access in the Automic issuer portal (Settings > API Management).

```sh
npm install
npm run build
```

| Variable | Required | Default |
|---|---|---|
| `AUTOMIC_CLIENT_ID` | yes | |
| `AUTOMIC_CLIENT_SECRET` | yes | |
| `AUTOMIC_API_KEY` | yes | |
| `AUTOMIC_BASE_URL` | no | `https://api.automic.com.au` |
| `AUTOMIC_REPORT_DIR` | no | `$TMPDIR/automic-mcp-reports` |

Claude Code:

```sh
claude mcp add automic \
  -e AUTOMIC_CLIENT_ID=... -e AUTOMIC_CLIENT_SECRET=... -e AUTOMIC_API_KEY=... \
  -- node /path/to/automic-mcp/dist/index.js
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "automic": {
      "command": "node",
      "args": ["/path/to/automic-mcp/dist/index.js"],
      "env": {
        "AUTOMIC_CLIENT_ID": "...",
        "AUTOMIC_CLIENT_SECRET": "...",
        "AUTOMIC_API_KEY": "..."
      }
    }
  }
}
```

## Tools

| Tool | Endpoint |
|---|---|
| `list_issuers` | `GET /api/issuer/v1` |
| `list_securities` | `GET /api/security/v1/issuer/{issuerId}` |
| `get_daily_prices` | `GET /api/daily-price/v1/issuer/{issuerId}/security/{securityId}` |
| `get_top_holders` | `GET /api/report/top-holders/v1/issuer/{issuerId}` |
| `list_distributions` | `GET /api/distributions/v2/issuer/{issuerId}` |
| `get_distribution_payment_list` | `GET /api/report/distributions-payment-list/v3/...` |
| `build_registration_details` | `POST /api/applications/v1/buildregodetails` |
| `run_register_listing_report` | `register-listing/v5` (async) |
| `run_transaction_listing_report` | `transaction-listing/v1` (async) |
| `run_fund_cash_flow_report` | `fund-cash-flow/v5` (async) |
| `get_report` | async report status and download |

Report and payment list results are written to `AUTOMIC_REPORT_DIR` (mode `0600`) and returned inline only when under 50 KB. These files contain investor personal data.

## Development

```sh
npm test
npm run typecheck
npm run smoke     # live test, needs AUTOMIC_* env vars
npm run inspect   # MCP Inspector
```

## License

[AGPL-3.0](LICENSE)
