# Cursor runner (manual)

1. Copy this repo to `~/.cursor/skills/fhevm-skillpack` (or open the repo
   directly — Cursor honours `.cursor/rules/*.md` referencing SKILL.md).
2. Open a chat with **Composer** (Cmd-I) on `claude-opus-4-7` or `gpt-5`.
3. For each `eval-suite/prompts/<NN>-*.md`:
   - Paste the prompt verbatim.
   - Save the generated contract to `eval-suite/results/cursor/<NN>.sol`
     (verbatim, no manual edits).
4. After all 14 prompts, run:
   ```bash
   node tools/fhe-eval.mjs report
   ```
   to update `REPORT.md` with Cursor's column.

## Tips
- Disable any "auto-format on save" — we want the agent's raw output.
- If Cursor splits the response across files, concatenate into one `.sol`.
- Take a screenshot of the chat for the submission video.
