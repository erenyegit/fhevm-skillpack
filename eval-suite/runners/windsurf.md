# Windsurf runner (manual)

1. Add the skill via Windsurf's MCP config
   (`~/.codeium/windsurf/mcp_config.json`): point to
   `mcp-server/server.mjs` so the agent can call `validate_snippet` /
   `suggest_fix`.
2. Open Cascade chat. Mention `@SKILL.md` to pull the skill into context.
3. For each prompt: paste, capture output, save to
   `eval-suite/results/windsurf/<NN>.sol`.
4. `node tools/fhe-eval.mjs report` to update `REPORT.md`.
