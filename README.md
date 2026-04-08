# anaf-efactura-mcp

MCP server for Romania's **ANAF e-Factura** system — create, upload, validate, and manage electronic invoices via SPV (Spațiul Privat Virtual).

Built for the [Model Context Protocol](https://modelcontextprotocol.io), works with Claude Desktop, Cursor, Windsurf, and any MCP-compatible client.

## Why this exists

Romania mandates e-invoicing for all B2B transactions through ANAF's SPV system. This MCP server lets AI assistants handle the entire invoicing workflow — from generating compliant UBL 2.1 CIUS-RO XML to uploading directly to ANAF's production API.

No more manual XML editing. No more copy-pasting into ANAF's web interface. Just talk to your AI assistant:

> *"Facturează-l pe Client SRL, CIF 12345678, 5 ore consultanță la 300 RON/oră, TVA 19%"*

## Quick Start

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "anaf-efactura": {
      "command": "npx",
      "args": ["-y", "anaf-efactura-mcp"],
      "env": {
        "ANAF_ENV": "test",
        "ANAF_CLIENT_ID": "your-oauth-client-id",
        "ANAF_CLIENT_SECRET": "your-oauth-client-secret"
      }
    }
  }
}
```

### SSE Mode (remote / PM2)

```bash
ANAF_ENV=production MCP_TRANSPORT=sse MCP_PORT=3800 npx anaf-efactura-mcp
```

## Tools

| Tool | Auth | Description |
|------|:---:|-------------|
| `anaf_company_lookup` | No | Look up any Romanian company by CIF |
| `anaf_auth_start` | No | Generate OAuth2 authorization URL |
| `anaf_auth_callback` | No | Exchange auth code for tokens |
| `anaf_create_and_upload_invoice` | Yes | Create UBL XML + upload in one step |
| `anaf_upload_invoice` | Yes | Upload raw UBL XML |
| `anaf_generate_xml` | No | Generate XML without uploading |
| `anaf_validate_xml` | No | Offline validation of CIUS-RO fields |
| `anaf_upload_status` | Yes | Check upload status |
| `anaf_download` | Yes | Download response ZIP from SPV |
| `anaf_list_messages` | Yes | List sent/received invoices |

## Authentication

1. Register OAuth2 app at [ANAF OAuth Portal](https://logincert.anaf.ro)
2. Call `anaf_auth_start` to get authorization URL
3. Authorize in browser with digital certificate
4. Call `anaf_auth_callback` with the code
5. Tokens auto-refresh from then on

## Invoice Types

- `380` — Factură (Invoice)
- `381` — Notă de credit (Credit Note)
- `389` — Autofactură (Self-billing)

## XML Compliance

UBL 2.1 / EN 16931 / CIUS-RO 1.0.1

## Environment Variables

| Variable | Default |
|----------|---------|
| `ANAF_ENV` | `test` |
| `ANAF_CLIENT_ID` | — |
| `ANAF_CLIENT_SECRET` | — |
| `ANAF_CONFIG_DIR` | `~/.anaf-efactura-mcp` |
| `MCP_TRANSPORT` | `stdio` |
| `MCP_PORT` | `3800` |

## License

MIT
