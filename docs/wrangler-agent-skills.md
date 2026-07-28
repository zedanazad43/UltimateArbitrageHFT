# Wrangler Agent Skills — Reference Card

Wrangler is wired into the agent cooperation mesh as an MCP tool server.
Any agent that supports MCP (Copilot, Cursor/Merlin/Omni, Hermes, Manus) can call
these tools directly without writing shell scripts.

## Registration

| Config file | Agents served |
|---|---|
| `.mcp.json` | GitHub Copilot (VS Code), Hermes, Manus, OpenRouter agents |
| `.cursor/mcp.json` | Cursor, Merlin, Omni |
| `.vscode/settings.json` | VS Code built-in MCP client (Copilot Chat agent mode) |

The server is started on demand with:
```
npx wrangler@latest mcp
```
Auth env vars required: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.

---

## Tool Reference

### Deploy & Build

| Tool / Command | Description |
|---|---|
| `wrangler deploy` | Deploy `ultimatearbitragehft` Worker to Cloudflare |
| `wrangler deploy --dry-run` | Validate build without deploying (same as `npm run build:check`) |
| `wrangler deployments list` | List recent Worker deployments |
| `wrangler rollback` | Roll back to the previous deployment |
| `wrangler pages deploy <dir>` | Deploy frontend to Cloudflare Pages |

### Logs & Observability

| Tool / Command | Description |
|---|---|
| `wrangler tail ultimatearbitragehft` | Stream live Worker request/error logs |
| `wrangler tail ultimatearbitragehft --format json` | JSON log stream for agent parsing |
| `wrangler tail ultimatearbitragehft --search <pattern>` | Filter log stream by pattern |

### KV Storage (`BOT_STATE` / `KV_STORAGE`)

| Tool / Command | Description |
|---|---|
| `wrangler kv key list --binding BOT_STATE` | List all KV keys |
| `wrangler kv key get --binding BOT_STATE <key>` | Read a KV value |
| `wrangler kv key put --binding BOT_STATE <key> <value>` | Write a KV value |
| `wrangler kv key delete --binding BOT_STATE <key>` | Delete a KV key |

### D1 Database (`ultimate-arbitrage-db`)

| Tool / Command | Description |
|---|---|
| `wrangler d1 execute ultimate-arbitrage-db --command "SELECT …"` | Run a SQL query |
| `wrangler d1 execute ultimate-arbitrage-db --file <path.sql>` | Execute a SQL file |
| `wrangler d1 info ultimate-arbitrage-db` | Show database metadata |
| `wrangler d1 export ultimate-arbitrage-db --output dump.sql` | Export full database |

### R2 Storage (`ultimate-arbitrage-logs` / `ultimate-arbitrage-backups`)

| Tool / Command | Description |
|---|---|
| `wrangler r2 object list ultimate-arbitrage-logs` | List bucket objects |
| `wrangler r2 object get ultimate-arbitrage-logs/<key>` | Download an object |
| `wrangler r2 object put ultimate-arbitrage-logs/<key> --file <path>` | Upload an object |
| `wrangler r2 object delete ultimate-arbitrage-logs/<key>` | Delete an object |

### Secrets

| Tool / Command | Description |
|---|---|
| `wrangler secret list` | List all secret names (values are never shown) |
| `wrangler secret put <NAME>` | Set or rotate a secret |
| `wrangler secret delete <NAME>` | Remove a secret |

### Durable Objects

| Tool / Command | Description |
|---|---|
| `wrangler durable-objects namespace list` | List DO namespaces |

---

## Agent Usage Guide

### GitHub Copilot (VS Code agent mode)
Wrangler tools appear in the **MCP tools** panel. Example prompt:
> "Use wrangler to tail the Worker logs and show me the last error"

### Cursor / Merlin / Omni
Same tools, loaded from `.cursor/mcp.json`. Example:
> "Deploy the Worker and confirm the deployment ID"

### Hermes / Manus (via hero-super-agent Worker)
These agents connect to `hero-super-agent` (in `agents/cloudflare/`) as an
OpenAI-compatible backend. For local Hermes/Manus instances, also add the
wrangler MCP server to their tool config:
```json
{
  "tools": [
    {
      "type": "mcp",
      "server": "wrangler",
      "command": "npx",
      "args": ["-y", "wrangler@latest", "mcp"],
      "env": {
        "CLOUDFLARE_API_TOKEN": "${CLOUDFLARE_API_TOKEN}",
        "CLOUDFLARE_ACCOUNT_ID": "${CLOUDFLARE_ACCOUNT_ID}"
      }
    }
  ]
}
```

### OpenRouter agents
OpenRouter agents that support MCP tool calling can use the same entry as above.

---

## Environment Variables

| Variable | Where to set | Used by |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Shell env / `.env` / CI secret | All Wrangler commands |
| `CLOUDFLARE_ACCOUNT_ID` | Shell env / `.env` / CI secret | All Wrangler commands |

Generate a scoped token at: https://dash.cloudflare.com/profile/api-tokens
Required permissions: **Workers Scripts:Edit**, **Workers KV:Edit**, **D1:Edit**,
**R2:Edit**, **Pages:Edit**.

See also: `docs/env-reference.md` for the full environment variable catalog.

---

## CI Integration

CI uses `wrangler deploy --dry-run` (via `npm run build:check`) for validation.
Actual deployments run through `wrangler deploy` in `.github/workflows/deploy.yml`
using the `CLOUDFLARE_API_TOKEN` repository secret.
