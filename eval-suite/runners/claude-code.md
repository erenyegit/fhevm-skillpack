# Claude Code runner

Two ways to run the eval suite against Claude Code.

## A) Headless API (auto)

```bash
export ANTHROPIC_API_KEY=sk-ant-...
pnpm add -w @anthropic-ai/sdk
node tools/fhe-eval.mjs claude-code        # runs all 14 prompts, evaluates, builds REPORT.md
```

The runner calls `claude-opus-4-7` once per prompt with the SKILL.md
contents as the system prompt and the prompt text as the user message.
Outputs are saved to `eval-suite/results/claude-code/<NN>.sol`.

## B) Interactive Claude Code (manual reproduction)

For each `eval-suite/prompts/<NN>-*.md`:

1. Open Claude Code in a fresh terminal in this repo.
2. Confirm the skill loads automatically (`claude skills list` should show
   `fhevm-skillpack`). If not, copy/symlink this repo to
   `~/.claude/skills/fhevm-skillpack`.
3. Paste the prompt verbatim.
4. After Claude responds, copy the contract code into
   `eval-suite/results/claude-code-manual/<NN>.sol`.
5. Run `node tools/fhe-eval.mjs report` to refresh `REPORT.md`.
