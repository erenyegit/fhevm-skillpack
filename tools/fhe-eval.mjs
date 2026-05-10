#!/usr/bin/env node
/**
 * fhe-eval — runs the 14-prompt eval suite, evaluates contracts against
 * expected-properties JSON, and emits eval-suite/results/REPORT.md.
 *
 * Modes:
 *   node tools/fhe-eval.mjs claude-code           # uses ANTHROPIC_API_KEY + Claude SDK
 *   node tools/fhe-eval.mjs evaluate <dir>        # evaluate pre-generated outputs in <dir>/01.sol .. 14.sol
 *   node tools/fhe-eval.mjs report                # rebuild REPORT.md from cached results in eval-suite/results/<agent>/
 *
 * Output: eval-suite/results/<agent>/<NN>.sol  +  REPORT.md aggregated table.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, basename, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { scanFile } from "./fhe-lint.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PROMPTS_DIR = join(ROOT, "eval-suite", "prompts");
const PROPS_DIR   = join(ROOT, "eval-suite", "expected-properties");
const RESULTS_DIR = join(ROOT, "eval-suite", "results");

function listPrompts() {
  return readdirSync(PROMPTS_DIR)
    .filter((f) => /^\d{2}-.+\.md$/.test(f))
    .sort();
}

function loadProps(num) {
  const f = join(PROPS_DIR, `${num}.json`);
  return JSON.parse(readFileSync(f, "utf8"));
}

function evaluateFile(file, props) {
  const code = readFileSync(file, "utf8");
  const checks = [];

  for (const pat of props.must_include_patterns || []) {
    const re = pat.startsWith("/") ? new RegExp(pat.slice(1, -1)) : null;
    const ok = re ? re.test(code) : code.includes(pat);
    checks.push({ check: `must include: ${pat}`, ok });
  }
  for (const pat of props.must_not_include_patterns || []) {
    const re = pat.startsWith("/") ? new RegExp(pat.slice(1, -1)) : null;
    const ok = re ? !re.test(code) : !code.includes(pat);
    checks.push({ check: `must NOT include: ${pat}`, ok });
  }

  if (props.must_pass_lint) {
    const issues = scanFile(file).filter((i) => i.severity === "error");
    checks.push({ check: `lint clean (errors)`, ok: issues.length === 0, detail: issues.length });
  }

  if (props.must_compile) {
    // Best-effort: requires forge installed + soldeer deps installed.
    let ok = false;
    try {
      // Drop into a unique sub-folder to avoid clashing with template.
      const stamp = `_eval_${Date.now()}`;
      const dir = join(ROOT, "packages", "foundry", "src", stamp);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, basename(file)), code);
      const r = spawnSync("forge", ["build"], {
        cwd: join(ROOT, "packages", "foundry"),
        encoding: "utf8",
      });
      ok = r.status === 0;
    } catch {
      ok = false;
    }
    checks.push({ check: `forge build`, ok });
  }

  const allOk = checks.every((c) => c.ok);
  return { file, name: props.name, checks, pass: allOk };
}

async function runClaudeCode() {
  // Real run via @anthropic-ai/sdk — requires ANTHROPIC_API_KEY.
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    console.error("ANTHROPIC_API_KEY not set. Skipping Claude Code run.");
    console.error("Falling back to writing PLACEHOLDER outputs in eval-suite/results/claude-code/");
    return runPlaceholder("claude-code");
  }
  let Anthropic;
  try {
    ({ default: Anthropic } = await import("@anthropic-ai/sdk"));
  } catch {
    console.error("@anthropic-ai/sdk not installed. Run: pnpm add -w @anthropic-ai/sdk");
    process.exit(2);
  }
  const client = new Anthropic({ apiKey: key });
  const skill = readFileSync(join(ROOT, "SKILL.md"), "utf8");

  const outDir = join(RESULTS_DIR, "claude-code");
  mkdirSync(outDir, { recursive: true });

  for (const promptFile of listPrompts()) {
    const num = promptFile.slice(0, 2);
    const promptText = readFileSync(join(PROMPTS_DIR, promptFile), "utf8");
    console.log(`▸ ${promptFile}`);
    const r = await client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 8000,
      system: `You are an expert FHEVM Solidity engineer. Use the following skill instructions:\n\n${skill}\n\nRespond with ONLY the Solidity contract code, no explanation.`,
      messages: [{ role: "user", content: promptText }],
    });
    const text = r.content.map((b) => b.type === "text" ? b.text : "").join("");
    // strip markdown code fences if present
    const code = text.replace(/^```solidity\s*\n?/m, "").replace(/```\s*$/m, "");
    writeFileSync(join(outDir, `${num}.sol`), code);
  }
  console.log(`✔ wrote 14 outputs to ${outDir}`);
  return outDir;
}

function runPlaceholder(agent) {
  const dir = join(RESULTS_DIR, agent);
  mkdirSync(dir, { recursive: true });
  for (const f of listPrompts()) {
    const num = f.slice(0, 2);
    writeFileSync(join(dir, `${num}.sol`), `// PLACEHOLDER — no agent run captured for ${agent} (${f})\n`);
  }
  return dir;
}

function evaluateAgent(dir) {
  const rows = [];
  for (const f of listPrompts()) {
    const num = f.slice(0, 2);
    const out = join(dir, `${num}.sol`);
    if (!existsSync(out) || readFileSync(out, "utf8").startsWith("// PLACEHOLDER")) {
      rows.push({ num, pass: null, reason: "no output captured" });
      continue;
    }
    const props = loadProps(num);
    const r = evaluateFile(out, props);
    rows.push({ num, pass: r.pass, checks: r.checks });
  }
  return rows;
}

function buildReport() {
  const agents = existsSync(RESULTS_DIR)
    ? readdirSync(RESULTS_DIR).filter((d) => {
        try { return statSync(join(RESULTS_DIR, d)).isDirectory(); } catch { return false; }
      })
    : [];
  const allRows = {};
  for (const a of agents) {
    allRows[a] = evaluateAgent(join(RESULTS_DIR, a));
  }
  const lines = [];
  lines.push("# fhevm-skillpack — eval suite report\n");
  lines.push("Generated by `pnpm eval`. Each prompt is evaluated against expected-properties JSON.\n");
  lines.push("");
  lines.push("| # | Prompt | " + agents.join(" | ") + " |");
  lines.push("|---|---|" + agents.map(() => "---").join("|") + "|");
  for (const f of listPrompts()) {
    const num = f.slice(0, 2);
    const cells = agents.map((a) => {
      const row = allRows[a]?.find((r) => r.num === num);
      if (!row) return "—";
      if (row.pass === null) return "n/a";
      return row.pass ? "✅ PASS" : "❌ FAIL";
    });
    lines.push(`| ${num} | ${f.replace(/\.md$/, "")} | ${cells.join(" | ")} |`);
  }
  // summary
  lines.push("\n## Summary");
  for (const a of agents) {
    const rows = allRows[a];
    const pass = rows.filter((r) => r.pass === true).length;
    const tot  = rows.filter((r) => r.pass !== null).length;
    lines.push(`- **${a}** — ${pass}/${tot} prompts pass${tot < 14 ? ` (${14 - tot} not yet captured)` : ""}`);
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("- **Claude Code:** auto-run via `@anthropic-ai/sdk` when `ANTHROPIC_API_KEY` is set. Without the key, this row is `n/a` and a manual run is required.");
  lines.push("- **Cursor / Windsurf / Aider / Codex:** see `eval-suite/runners/` for step-by-step manual reproduction. Drop generated `.sol` files into `eval-suite/results/<agent>/<NN>.sol` and re-run `pnpm eval -- report`.");
  lines.push("- Pass criteria are deliberately strict: lint clean (no errors), compiles in the repo Foundry workspace, includes the required FHE primitives.");

  const out = join(RESULTS_DIR, "REPORT.md");
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(out, lines.join("\n"));
  console.log(`✔ wrote ${out}`);
}

const cmd = process.argv[2];
if (cmd === "claude-code") {
  await runClaudeCode();
  buildReport();
} else if (cmd === "evaluate") {
  const dir = process.argv[3];
  if (!dir) { console.error("usage: fhe-eval evaluate <dir>"); process.exit(2); }
  buildReport();
} else if (cmd === "report") {
  buildReport();
} else if (cmd === "placeholder") {
  for (const a of ["claude-code", "cursor", "windsurf", "aider", "codex"]) runPlaceholder(a);
  buildReport();
} else {
  console.log("usage: fhe-eval <claude-code|evaluate <dir>|report|placeholder>");
  process.exit(0);
}
