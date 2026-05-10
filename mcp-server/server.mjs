#!/usr/bin/env node
/**
 * fhevm-skillpack MCP server
 *
 * Exposes 4 tools to any MCP-compatible agent (Claude Code, Cursor, Windsurf):
 *   - lookup_fhe_op    — operation reference + HCU cost + minimal example
 *   - validate_snippet — runs fhe-lint on a snippet, returns structured issues
 *   - suggest_fix      — runs fhe-doctor on a snippet, returns patched code
 *   - compile_test     — drops snippet into the foundry workspace and runs forge build
 *
 * Install (claude code):
 *   claude mcp add --scope user fhevm-skillpack -- node /absolute/path/to/mcp-server/server.mjs
 *
 * Install (cursor):
 *   add to ~/.cursor/mcp.json:
 *   { "mcpServers": { "fhevm-skillpack": { "command": "node",
 *     "args": ["/absolute/path/to/mcp-server/server.mjs"] } } }
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ───────────── operation cheatsheet (data) ─────────────
const OPS = {
  "FHE.add":    { sig: "FHE.add(euintX, euintX | uintX) → euintX", hcu: { e64: "162k (133k scalar)" }, note: "UNCHECKED — guard with FHE.select for overflow.", example: "euint64 sum = FHE.add(a, b);" },
  "FHE.sub":    { sig: "FHE.sub(euintX, euintX | uintX) → euintX", hcu: { e64: "162k (133k scalar)" }, note: "Wraps to large positive on underflow.", example: "euint64 diff = FHE.sub(a, b);" },
  "FHE.mul":    { sig: "FHE.mul(euintX, euintX | uintX) → euintX", hcu: { e64: "596k (365k scalar)" }, note: "Highest arithmetic cost. Always cap inputs.", example: "euint64 fee = FHE.mul(amount, FHE.asEuint64(BPS));" },
  "FHE.div":    { sig: "FHE.div(euintX, uintX) → euintX", hcu: { e64: "715k" }, note: "Plaintext divisor only. AP-008.", example: "euint64 q = FHE.div(amount, 100);" },
  "FHE.select": { sig: "FHE.select(ebool, euintX, euintX) → euintX", hcu: { e64: "55k" }, note: "Cheap. Use instead of if/else on encrypted bools (AP-001).", example: "euint64 max = FHE.select(FHE.gt(a, b), a, b);" },
  "FHE.gt":     { sig: "FHE.gt(euintX, euintX) → ebool", hcu: { e64: "152k (116k scalar)" }, note: "Pair with FHE.select for branching.", example: "ebool isHigher = FHE.gt(a, b);" },
  "FHE.fromExternal": { sig: "FHE.fromExternal(externalEuintX, bytes proof) → euintX", hcu: { e64: "varies" }, note: "Validates input proof, binds to (contract, encrypter).", example: "euint64 amount = FHE.fromExternal(encAmount, inputProof);" },
  "FHE.allowThis": { sig: "FHE.allowThis(handle)", hcu: { e64: "ACL write" }, note: "Required after every storage write of an encrypted handle (AP-004).", example: "FHE.allowThis(_balance);" },
  "FHE.allow":     { sig: "FHE.allow(handle, address)", hcu: { e64: "ACL write" }, note: "Persistent grant — prefer allowTransient for helpers (AP-012).", example: "FHE.allow(_balance, msg.sender);" },
  "FHE.allowTransient": { sig: "FHE.allowTransient(handle, address)", hcu: { e64: "ACL transient" }, note: "EIP-1153 transient — auto-clears at end of tx.", example: "FHE.allowTransient(amount, helper);" },
  "FHE.makePubliclyDecryptable": { sig: "FHE.makePubliclyDecryptable(handle)", hcu: { e64: "ACL public" }, note: "IRREVERSIBLE — anyone can decrypt forever. Pair with finality delay (AP-019).", example: "FHE.makePubliclyDecryptable(_total);" },
  "FHE.checkSignatures": { sig: "FHE.checkSignatures(plaintext, bytes[] sigs)", hcu: { e64: "verify" }, note: "Verify KMS quorum in async-decrypt callback. Combine with delete-before-effects (AP-010).", example: "FHE.checkSignatures(plain, sigs);" },
};

// ───────────── linter / doctor as JS imports ─────────────
import { scanFile, RULES } from "../tools/fhe-lint.mjs";

function lintSnippet(code, isFrontend = false) {
  const tmp = mkdtempSync(join(tmpdir(), "fhe-mcp-"));
  const ext = isFrontend ? "tsx" : "sol";
  const file = join(tmp, `snippet.${ext}`);
  writeFileSync(file, code);
  try {
    return scanFile(file);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function doctorSnippet(code) {
  const tmp = mkdtempSync(join(tmpdir(), "fhe-mcp-"));
  const file = join(tmp, "snippet.sol");
  writeFileSync(file, code);
  try {
    const r = spawnSync("node", [join(ROOT, "tools", "fhe-doctor.mjs"), file, "--write"], {
      encoding: "utf8",
    });
    return { stdout: r.stdout, stderr: r.stderr, patched: readFileSync(file, "utf8") };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function compileSnippet(code) {
  // Drops the snippet into a sub-folder in packages/foundry/src and runs forge build.
  // Skips if forge is not installed or dependencies aren't installed.
  try {
    execSync("forge --version", { stdio: "pipe" });
  } catch {
    return { ok: false, message: "forge not installed; cannot compile" };
  }
  const tmpDir = join(ROOT, "packages", "foundry", "src", "_mcp_snippets");
  const file = join(tmpDir, `Snippet_${Date.now()}.sol`);
  try {
    writeFileSync(file, code);
    const r = spawnSync("forge", ["build", "--no-cache"], {
      cwd: join(ROOT, "packages", "foundry"),
      encoding: "utf8",
    });
    return { ok: r.status === 0, stdout: r.stdout, stderr: r.stderr };
  } catch (e) {
    return { ok: false, message: e.message };
  } finally {
    try { rmSync(file); } catch {}
  }
}

// ───────────── MCP server wiring ─────────────
const server = new Server(
  { name: "fhevm-skillpack", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "lookup_fhe_op",
      description: "Look up an FHE.* operation: signature, HCU cost, and a minimal Solidity example.",
      inputSchema: {
        type: "object",
        properties: { op: { type: "string", description: "e.g. 'FHE.add', 'FHE.allowThis'" } },
        required: ["op"],
      },
    },
    {
      name: "validate_snippet",
      description:
        "Run fhe-lint on a Solidity snippet (or a frontend .tsx snippet) and return all detected anti-patterns with rule IDs, severities, line numbers, and suggested fixes.",
      inputSchema: {
        type: "object",
        properties: {
          code: { type: "string", description: "Source code to lint" },
          frontend: { type: "boolean", description: "Treat as React/TSX (enables AP-014/15/16)" },
        },
        required: ["code"],
      },
    },
    {
      name: "suggest_fix",
      description:
        "Run fhe-doctor's auto-fix on a Solidity snippet (rewrites AP-001/002/004/005/007 mechanically). Returns the patched code and the list of applied fixes.",
      inputSchema: {
        type: "object",
        properties: { code: { type: "string", description: "Source code to fix" } },
        required: ["code"],
      },
    },
    {
      name: "compile_test",
      description:
        "Drop a Solidity snippet into the foundry workspace and run `forge build`. Returns success and stderr. Requires forge installed and `pnpm contracts:install` already run.",
      inputSchema: {
        type: "object",
        properties: { code: { type: "string", description: "Solidity source to compile" } },
        required: ["code"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  if (name === "lookup_fhe_op") {
    const info = OPS[args.op] || OPS[args.op?.replace(/\(.*$/, "")];
    if (!info) {
      return {
        content: [{ type: "text", text: `Unknown op: ${args.op}\nKnown: ${Object.keys(OPS).join(", ")}` }],
      };
    }
    return {
      content: [{
        type: "text",
        text: `**${args.op}**\n\nSignature: \`${info.sig}\`\nHCU (euint64): ${info.hcu.e64}\nNote: ${info.note}\n\nExample:\n\`\`\`solidity\n${info.example}\n\`\`\``,
      }],
    };
  }
  if (name === "validate_snippet") {
    const issues = lintSnippet(args.code, !!args.frontend);
    if (issues.length === 0) {
      return { content: [{ type: "text", text: "✔ fhe-lint: clean (no anti-patterns detected)" }] };
    }
    return { content: [{ type: "text", text: JSON.stringify({ count: issues.length, issues }, null, 2) }] };
  }
  if (name === "suggest_fix") {
    const r = doctorSnippet(args.code);
    return {
      content: [{
        type: "text",
        text: `${r.stdout || ""}\n\n--- patched ---\n${r.patched}`,
      }],
    };
  }
  if (name === "compile_test") {
    const r = compileSnippet(args.code);
    return {
      content: [{
        type: "text",
        text: r.ok ? `✔ forge build OK\n${r.stdout || ""}` : `✘ build failed\n${r.stderr || r.message}`,
      }],
    };
  }
  return { content: [{ type: "text", text: `unknown tool: ${name}` }], isError: true };
});

await server.connect(new StdioServerTransport());
