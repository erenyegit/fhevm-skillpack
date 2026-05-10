# fhevm-skillpack MCP server

Exposes the skillpack's linter, auto-fix, op cheatsheet, and Foundry compile
gate as **MCP tools** — usable from any MCP-compatible agent (Claude Code,
Cursor, Windsurf, Codex CLI).

## Tools

| Tool | Purpose |
|---|---|
| `lookup_fhe_op` | Op signature + HCU cost + minimal example for one `FHE.*` call |
| `validate_snippet` | Run `fhe-lint` on inline source — returns structured anti-patterns |
| `suggest_fix` | Run `fhe-doctor` auto-fix — returns patched code |
| `compile_test` | Drop snippet into the Foundry workspace and run `forge build` |

## Install

```bash
pnpm install                                # installs @modelcontextprotocol/sdk
```

### Claude Code
```bash
claude mcp add --scope user fhevm-skillpack \
  -- node /absolute/path/to/fhevm-skillpack/mcp-server/server.mjs
```

### Cursor — `~/.cursor/mcp.json`
```json
{
  "mcpServers": {
    "fhevm-skillpack": {
      "command": "node",
      "args": ["/absolute/path/to/fhevm-skillpack/mcp-server/server.mjs"]
    }
  }
}
```

### Windsurf — `~/.codeium/windsurf/mcp_config.json`
Same format as Cursor.

## Run standalone (for debugging)
```bash
pnpm --filter fhevm-skillpack-mcp start
```
Talks JSON-RPC over stdio. Pipe a `tools/list` request to inspect:
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node mcp-server/server.mjs
```
