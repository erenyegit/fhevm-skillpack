#!/usr/bin/env node
/**
 * fhe-doctor — auto-fix companion to fhe-lint.
 *
 * Mechanical rewrites for rules where the fix is unambiguous:
 *   AP-001  if(FHE.gt(a,b)){x=a;}else{x=b;}    → x = FHE.select(FHE.gt(a,b), a, b);
 *   AP-002  TFHE.* → FHE.*  (and add modern import if absent)
 *   AP-004  storage write missing allowThis    → insert FHE.allowThis(<lhs>);
 *   AP-005  uintN(euintN.unwrap(h))            → comment-out + insert TODO marker
 *   AP-007  euint256 ... balance/amount/...    → euint64 ...
 *
 * Other rules: produce a "manual fix required" report (no rewrite).
 *
 * Usage:
 *   node tools/fhe-doctor.mjs <path-or-glob>            # dry run (default)
 *   node tools/fhe-doctor.mjs <path-or-glob> --write    # apply edits in place
 */

import { readdirSync, readFileSync, statSync, existsSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();

const REWRITES = [
  {
    id: "AP-002a",
    desc: "Replace `import \"fhevm/lib/TFHE.sol\";` with modern FHE import",
    apply(text) {
      let changed = false;
      let next = text.replace(
        /import\s+["']fhevm\/lib\/TFHE\.sol["']\s*;?/g,
        () => {
          changed = true;
          return `import {FHE, euint64, externalEuint64, ebool} from "@fhevm/solidity/lib/FHE.sol";\nimport {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";`;
        },
      );
      return [next, changed];
    },
  },
  {
    id: "AP-002b",
    desc: "Replace TFHE.<op> calls with FHE.<op>",
    apply(text) {
      let changed = false;
      const next = text.replace(/\bTFHE\s*\.\s*/g, () => {
        changed = true;
        return "FHE.";
      });
      return [next, changed];
    },
  },
  {
    id: "AP-007",
    desc: "Narrow euint256 storage of monetary fields to euint64",
    apply(text) {
      let changed = false;
      const next = text.replace(
        /\beuint256\b([^;]*?(_)?(balance|amount|total|supply|reserve|liquidity|pledge|deposit)\w*)/gi,
        (m, rest) => {
          changed = true;
          return `euint64${rest}`;
        },
      );
      return [next, changed];
    },
  },
  {
    id: "AP-001",
    desc: "Rewrite simple if/else on encrypted bool to FHE.select",
    apply(text) {
      let changed = false;
      // pattern:  if (FHE.gt(A,B)) { X = Y; } else { X = Z; }
      // captures the full structure; conservative — single-statement branches only.
      const re = /if\s*\(\s*(FHE\.(?:gt|lt|le|ge|eq|ne)\s*\([^)]+\))\s*\)\s*\{\s*([_A-Za-z]\w*[^=]*?)\s*=\s*([^;]+);\s*\}\s*else\s*\{\s*\2\s*=\s*([^;]+);\s*\}/g;
      const next = text.replace(re, (_m, cond, lhs, ifTrue, ifFalse) => {
        changed = true;
        return `${lhs} = FHE.select(${cond}, ${ifTrue}, ${ifFalse});`;
      });
      return [next, changed];
    },
  },
  {
    id: "AP-004",
    desc: "Insert FHE.allowThis after storage write of encrypted handle",
    apply(text) {
      let changed = false;
      const lines = text.split(/\r?\n/);
      const out = [];
      for (let i = 0; i < lines.length; i++) {
        out.push(lines[i]);
        const m = lines[i].match(
          /^(\s*)([_A-Za-z][\w.\[\]]*)\s*=\s*FHE\.(add|sub|mul|div|rem|min|max|and|or|xor|not|shl|shr|select|fromExternal|asEuint8|asEuint16|asEuint32|asEuint64|asEuint128|asEuint256|asEaddress|asEbool)\s*\(/,
        );
        if (!m) continue;
        // skip locals declared inline
        if (/^\s*(euint8|euint16|euint32|euint64|euint128|euint256|ebool|eaddress)\s+/.test(lines[i])) continue;
        const indent = m[1];
        const lhs = m[2];
        // already-allowed within next 6 lines?
        const window = lines.slice(i + 1, i + 7).map((l) => l.replace(/\/\/.*$/, "")).join("\n");
        const re = new RegExp(`FHE\\.allowThis\\s*\\(\\s*${escapeRe(lhs)}`);
        if (re.test(window)) continue;
        out.push(`${indent}FHE.allowThis(${lhs}); // [auto-fixed: AP-004]`);
        changed = true;
      }
      return [out.join("\n"), changed];
    },
  },
  {
    id: "AP-005",
    desc: "Annotate direct euint.unwrap → uint cast with TODO marker",
    apply(text) {
      let changed = false;
      const next = text.replace(
        /\b(uint8|uint16|uint32|uint64|uint128|uint256)\s*\(\s*(euint8|euint16|euint32|euint64|euint128|euint256|ebool|eaddress)\.unwrap\([^)]+\)\s*\)/g,
        (m) => {
          changed = true;
          return `${m} /* [AP-005 TODO: handle.unwrap() returns ciphertext id, NOT plaintext — use async decryption] */`;
        },
      );
      return [next, changed];
    },
  },
];

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function* walk(p) {
  if (!existsSync(p)) return;
  const st = statSync(p);
  if (st.isFile()) { if (/\.sol$/.test(p)) yield p; return; }
  for (const e of readdirSync(p)) {
    if (["node_modules", "dependencies", "out", ".git"].includes(e)) continue;
    yield* walk(join(p, e));
  }
}

function processFile(file, write) {
  const original = readFileSync(file, "utf8");
  let text = original;
  const applied = [];
  for (const r of REWRITES) {
    const [next, changed] = r.apply(text);
    if (changed) {
      applied.push(r);
      text = next;
    }
  }
  if (applied.length === 0) return null;
  if (write) writeFileSync(file, text);
  return { file, applied, before: original, after: text };
}

const args = process.argv.slice(2);
const write = args.includes("--write");
const targets = args.filter((a) => !a.startsWith("--"));
if (targets.length === 0) {
  console.error("Usage: fhe-doctor <path> [--write]");
  process.exit(2);
}

let touched = 0;
for (const t of targets) {
  for (const f of walk(t)) {
    const res = processFile(f, write);
    if (!res) continue;
    touched++;
    console.log(`${write ? "✎ wrote" : "would change"} ${relative(ROOT, f)}`);
    for (const r of res.applied) console.log(`     ${r.id}  ${r.desc}`);
  }
}

if (touched === 0) {
  console.log("fhe-doctor: nothing to fix.");
} else {
  console.log(`\n${write ? "Applied" : "Preview"} fixes on ${touched} file(s).`);
  if (!write) console.log("Re-run with --write to apply.");
  console.log("\nNote: AP-003 (sync decrypt), AP-006 (missing fromExternal), AP-008 (encrypted divisor),");
  console.log("AP-009 (overflow guard), AP-010 (callback replay), AP-011–AP-022 require manual fixes.");
  console.log("Run `pnpm lint:fhe` to see what's left.");
}
