# Codex CLI runner (manual)

1. Open Codex CLI in this repo (`codex --skills SKILL.md` or paste skill
   into the system prompt).
2. For each `eval-suite/prompts/<NN>-*.md`, paste the prompt and capture
   output to `eval-suite/results/codex/<NN>.sol`.
3. Run `node tools/fhe-eval.mjs report` to refresh `REPORT.md`.
