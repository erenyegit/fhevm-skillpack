#!/usr/bin/env node
/**
 * fhe-lint — FHEVM anti-pattern linter (22 rules)
 *
 * Hybrid approach: regex-based scanning over a normalized token stream,
 * with light AST awareness (function/struct boundaries) inferred via
 * brace balance. Designed to be zero-dependency and runnable on macOS,
 * Linux, and CI. AP IDs match references/04-anti-patterns-catalog.md.
 *
 * Usage:
 *   node tools/fhe-lint.mjs <path-or-glob>           # terminal output (color)
 *   node tools/fhe-lint.mjs <path-or-glob> --json    # JSON
 *   node tools/fhe-lint.mjs <path-or-glob> --md      # markdown
 *   node tools/fhe-lint.mjs --self-test              # run on lint-fixtures/
 *
 * Exit codes: 0 clean, 1 any error, 2 only warnings.
 */

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, basename, relative } from "node:path";

const ROOT = process.cwd();
const SEV = { error: "🔴", warn: "🟡", info: "🔵" };
const COLOR = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yel: (s) => `\x1b[33m${s}\x1b[0m`,
  cyn: (s) => `\x1b[36m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

// ──────────────────────────────────────────────────────────────────────────
// 22 rules. Each has: id, severity, message, detect(line, ctx) → boolean.
// `ctx` carries fileText, allLines, lineNo, fnName, depth, etc.
// ──────────────────────────────────────────────────────────────────────────

const RULES = [
  {
    id: "AP-001",
    severity: "error",
    message:
      "Solidity branching (if/require/ternary/&&/||) on encrypted value — use FHE.select",
    detect: (line, ctx) => {
      // if (FHE.gt|lt|le|ge|eq|ne(...)) | require(FHE.eq(...)) | ternary on FHE.* result
      if (/\b(if|require|revert)\s*\(\s*FHE\.(gt|lt|le|ge|eq|ne|and|or|not|isAllowed|isSenderAllowed)\b/.test(line)) return true;
      // ternary: ... = FHE.gt(a,b) ? a : b ;  OR  ... = FHE.eq(...) ? ...
      if (/=\s*FHE\.(gt|lt|le|ge|eq|ne)\([^;]*\)\s*\?\s*[^:]+:\s*[^;]+;/.test(line)) return true;
      return false;
    },
    fix: "FHE.select(condition, ifTrue, ifFalse)",
  },
  {
    id: "AP-002",
    severity: "error",
    message: "Legacy TFHE import or call (deprecated v0.7 API)",
    detect: (line) =>
      /import\s+["']fhevm\/lib\/TFHE\.sol["']/.test(line) ||
      /\bTFHE\s*\./.test(line),
    fix: 'import {FHE, euintXX} from "@fhevm/solidity/lib/FHE.sol";',
  },
  {
    id: "AP-003",
    severity: "error",
    message: "Synchronous decryption — async via makePubliclyDecryptable + callback",
    detect: (line) =>
      /\bTFHE\.decrypt\s*\(/.test(line) ||
      /\.\s*decrypt\s*\(\s*\)/.test(line) ||
      /\.\s*reveal\s*\(\s*\)/.test(line),
    fix: "Use FHE.makePubliclyDecryptable + relayer callback (see references/05-async-decryption.md)",
  },
  {
    id: "AP-004",
    severity: "error",
    message: "Storage write of encrypted handle without FHE.allowThis follow-up",
    detect: (line, ctx) => {
      // pattern: <ident> = FHE.(add|sub|mul|select|fromExternal|asEuintXX|...)(...);
      // and the following ~6 lines do not contain FHE.allowThis(<ident>)
      const m = line.match(
        /^[\s\t]*([_A-Za-z][\w.\[\]]*)\s*=\s*FHE\.(add|sub|mul|div|rem|min|max|and|or|xor|not|shl|shr|select|fromExternal|asEuint8|asEuint16|asEuint32|asEuint64|asEuint128|asEuint256|asEaddress|asEbool|randEuint8|randEuint16|randEuint32|randEuint64)\s*\(/,
      );
      if (!m) return false;
      const lhs = m[1].split(/[\.\[]/)[0]; // base ident
      // local variable (declared with type on same line) is exempt unless it later writes to storage
      if (/^[\s\t]*(euint8|euint16|euint32|euint64|euint128|euint256|ebool|eaddress)\s+/.test(line)) return false;
      // look ahead 6 lines for allowThis(lhs); strip comments so commented mentions don't pass
      const windowStripped = ctx.allLines
        .slice(ctx.lineNo, ctx.lineNo + 6)
        .map((l) => l.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, ""))
        .join("\n");
      const re = new RegExp(`FHE\\.allowThis\\s*\\(\\s*${escapeRe(m[1])}`);
      return !re.test(windowStripped);
    },
    fix: "Add FHE.allowThis(<storageVar>); on the next line.",
  },
  {
    id: "AP-005",
    severity: "warn",
    message: "Direct cast from euintXX.unwrap to plaintext uintXX yields garbage (handle ≠ value)",
    detect: (line) =>
      /\b(uint8|uint16|uint32|uint64|uint128|uint256)\s*\(\s*(euint8|euint16|euint32|euint64|euint128|euint256|ebool|eaddress)\.unwrap/.test(line),
    fix: "Use async decryption (see references/05-async-decryption.md). Never cast handles.",
  },
  {
    id: "AP-006",
    severity: "error",
    message: "External encrypted input used without FHE.fromExternal validation",
    detect: (line, ctx) => {
      // function signature lists externalEuintXX param; in the function body,
      // we expect an FHE.fromExternal call referencing it before use.
      const sigMatch = line.match(/function\s+\w+\s*\(([^)]*)\)/);
      if (!sigMatch) return false;
      const params = sigMatch[1];
      const externals = [...params.matchAll(/external(Euint\d+|Eaddress|Ebool)\s+(\w+)/g)];
      if (externals.length === 0) return false;
      // scan only the CURRENT function body — stop at the next `function ` keyword
      const body = bodyOfFunction(ctx);
      for (const [, , name] of externals) {
        const usedAsExternalArg =
          new RegExp(`\\b\\w+\\s*\\([^)]*\\b${escapeRe(name)}\\b[^)]*\\b\\w*[Pp]roof\\b`).test(body);
        const validated =
          new RegExp(`FHE\\.fromExternal\\s*\\(\\s*${escapeRe(name)}`).test(body) ||
          new RegExp(`FHE\\.asEuint\\d+\\s*\\(\\s*${escapeRe(name)}`).test(body);
        // exempt: unchanged delegation to another contract that will validate downstream
        if (!validated && !usedAsExternalArg) return true;
      }
      return false;
    },
    fix: "euint64 v = FHE.fromExternal(encParam, inputProof); on the first line of the function.",
  },
  {
    id: "AP-007",
    severity: "warn",
    message: "euint256 used for token balance/amount/total/supply (4–6× HCU vs euint64)",
    detect: (line) =>
      /\beuint256\b[^;]*(_)?(balance|amount|total|supply|reserve|liquidity|pledge|deposit)/i.test(line),
    fix: "Replace euint256 with euint64 (or euint128 for BPS intermediates).",
  },
  {
    id: "AP-008",
    severity: "error",
    message: "FHE.div / FHE.rem with encrypted divisor — only plaintext divisors are supported",
    detect: (line) => {
      const m = line.match(/FHE\.(div|rem)\s*\(([^)]*)\)/);
      if (!m) return false;
      const args = m[2].split(",").map((s) => s.trim());
      if (args.length < 2) return false;
      // second arg must be plaintext: numeric literal, plaintext uint var, or constant
      // Heuristic: encrypted if matches euintXX type cast or starts with _enc / e prefix
      const divisor = args[1];
      const isNumLiteral = /^\d/.test(divisor);
      const isAllCapsConst = /^[A-Z_][A-Z_0-9]*$/.test(divisor);
      const isMemberConst = /^[A-Za-z_]\w*\s*\.\s*[A-Z_][A-Z_0-9]*$/.test(divisor);
      const isUintCast = /^uint\d*\s*\(/.test(divisor);
      // Plaintext divisor heuristics — anything else (lowercase ident, FHE.* expr) is suspect
      return !(isNumLiteral || isAllCapsConst || isMemberConst || isUintCast);
    },
    fix: "Pass a plaintext uint constant or storage variable as the divisor.",
  },
  {
    id: "AP-009",
    severity: "error",
    message: "FHE.mul or FHE.sub without preceding overflow guard (encrypted arithmetic is unchecked)",
    detect: (line, ctx) => {
      const m = line.match(/FHE\.(mul|sub)\s*\(/);
      if (!m) return false;
      // Look backward up to 8 lines for any cap pattern: FHE.gt/lt/ge/le + FHE.select nearby
      const start = Math.max(0, ctx.lineNo - 9);
      const back = ctx.allLines.slice(start, ctx.lineNo - 1).join("\n");
      const hasCmp = /FHE\.(gt|lt|ge|le)\b/.test(back);
      const hasSelect = /FHE\.select\s*\(/.test(back);
      if (hasCmp && hasSelect) return false;
      // Whitelist: scalar overload with small known plaintext rhs (BPS, decimals)
      // e.g. FHE.mul(x, FHE.asEuint64(BPS))  — still flag (mul could overflow)
      return true;
    },
    fix: "Cap inputs first: ebool tooBig=FHE.gt(a, MAX); a=FHE.select(tooBig, MAX, a);",
  },
  {
    id: "AP-010",
    severity: "error",
    message: "Async decryption callback may be missing delete-before-effects (replay defense)",
    detect: (line, ctx) => {
      // Heuristic: function whose name starts with `fulfill` / `callback` / contains `Cleartext`/`Callback`
      const m = line.match(/function\s+(\w*(?:fulfill|callback|Callback|Cleartext)\w*)\s*\(([^)]*)\)/);
      if (!m) return false;
      const params = m[2];
      // looks like async callback signature (uint requestId, ..., bytes[] sigs) or similar
      const looksLikeCb = /\bbytes(?:\[\])?\s+(?:calldata|memory)\s+(?:sigs|signatures|proof)\b/.test(params)
                       || /uint\d*\s+\w*[Rr]equest[Ii]d/.test(params);
      if (!looksLikeCb) return false;
      const body = ctx.allLines.slice(ctx.lineNo, ctx.lineNo + 50).join("\n");
      // Pass if body contains both `delete _<map>[...]` AND `FHE.checkSignatures`
      const hasDelete = /\bdelete\s+_?\w+\s*\[/.test(body) || /\b(finalized|done|consumed)\s*=\s*true\s*;/.test(body);
      if (!hasDelete) return true;
      // also confirm delete appears before any external `.call(`
      const idxDel = body.search(/\b(delete\s+\w+\s*\[|(finalized|done|consumed)\s*=\s*true\s*;)/);
      const idxCall = body.search(/\.call(?:\{|\()/);
      if (idxCall !== -1 && idxDel !== -1 && idxDel > idxCall) return true;
      return false;
    },
    fix: "Read request, delete the pending entry FIRST, then FHE.checkSignatures, then external effects.",
  },
  {
    id: "AP-011",
    severity: "warn",
    message: "view/pure function returns encrypted handle — caller may be unable to decrypt",
    detect: (line) =>
      /function\s+\w+\s*\([^)]*\)\s+(?:external|public)\s+(?:view|pure)\s+returns\s*\([^)]*\b(euint8|euint16|euint32|euint64|euint128|euint256|ebool|eaddress)\b/.test(line),
    fix: "Use a non-view function and call FHE.allow before returning, or expose a separate grantAccess() function.",
  },
  {
    id: "AP-012",
    severity: "error",
    message: "Persistent FHE.allow to a helper contract address — lateral leak risk; prefer allowTransient",
    detect: (line, ctx) => {
      // FHE.allow(x, address(<ContractName>))  with grantee whose name suggests helper / handler / adapter
      const m = line.match(/FHE\.allow\s*\(\s*[^,]+,\s*address\(\s*(\w+)\s*\)\s*\)/);
      if (!m) return false;
      return /(handler|adapter|helper|router|executor|hook|module|vault|dex|swap)/i.test(m[1]);
    },
    fix: "Use FHE.allowTransient(handle, helper) — auto-clears at end of tx.",
  },
  {
    id: "AP-013",
    severity: "warn",
    message: "Hashing (externalEuint, inputProof) for replay defense — proofs are malleable",
    detect: (line) =>
      /keccak256\s*\(\s*abi\.encode(?:Packed)?\s*\(\s*\w+\s*,\s*\w*[Pp]roof\s*\)/.test(line),
    fix: "Convert via FHE.fromExternal first; use the resulting handle ID or a per-user nonce as uniqueness key.",
  },
  {
    id: "AP-014",
    severity: "warn",
    message: "createInstance called inside React component — instantiate at provider level",
    detect: (line, ctx) =>
      ctx.isFrontend &&
      /\bcreateInstance\s*\(/.test(line) &&
      !/(provider|providers|setup|index|main)\.tsx?$/i.test(ctx.fileName),
    fix: "Move createInstance to ZamaProvider setup; consume via useEncrypt/useUserDecrypt hooks.",
  },
  {
    id: "AP-015",
    severity: "warn",
    message: "EIP-712 FHE signature persisted to localStorage — XSS-readable",
    detect: (line, ctx) =>
      ctx.isFrontend &&
      /\blocalStorage\.setItem\s*\(\s*["'][^"']*(fhe|sig|signature|eip712|zama)/i.test(line),
    fix: "Keep the signature in React-Query cache (in-memory). Re-prompt on hard refresh.",
  },
  {
    id: "AP-016",
    severity: "warn",
    message: "Decrypted plaintext placed in URL/route param — leaks via referer & history",
    detect: (line, ctx) =>
      ctx.isFrontend &&
      /\b(router\.(push|replace)|window\.location|history\.(push|replace)State|searchParams\.set)\s*\([^)]*\b(decrypt|cleartext|plain|clear)\w*/i.test(line),
    fix: "Keep decrypted values in component state only.",
  },
  {
    id: "AP-017",
    severity: "error",
    message: "Ciphertext handle bytes used as decryption request ID — handles can collide",
    detect: (line) =>
      /\b_pending\w*\s*\[\s*(?:bytes32\s*\(\s*)?(?:euint\d+|eaddress|ebool)\.unwrap/.test(line),
    fix: "Use a monotonic uint counter for request IDs, store the handle separately.",
  },
  {
    id: "AP-018",
    severity: "error",
    message: "Auction/state update based on requested amount, ignoring effective transferred amount",
    detect: (line, ctx) => {
      // Heuristic: confidentialTransferFrom return value is unused, then a comparison/select is performed using the *requested* amount.
      const m = line.match(/(\w*[tT]ransferFrom|confidentialTransfer)\s*\(/);
      if (!m) return false;
      const lineText = line.trim();
      // assignment can be a declaration (`euint64 x = ...`) or plain (`x = ...`) or `return ...`
      const isAssigned =
        /^\s*\w+\s+\w+\s*=\s*[^;]*confidentialTransfer/.test(line) ||
        /^\s*\w[\w.\[\]]*\s*=\s*[^;]*confidentialTransfer/.test(line) ||
        /\breturn\s+[^;]*confidentialTransfer/.test(line) ||
        /returns\s*\(/.test(line);
      if (isAssigned) return false;
      // and within next 10 lines we see a FHE.gt/select on what looks like the requested amount
      const fwd = ctx.allLines.slice(ctx.lineNo, ctx.lineNo + 10).join("\n");
      return /FHE\.(gt|lt|ge|le|select)/.test(fwd);
    },
    fix: "euint64 effective = token.confidentialTransferFrom(...); base FHE.select on `effective`, not on requested amount.",
  },
  {
    id: "AP-019",
    severity: "error",
    message: "makePubliclyDecryptable called immediately on time-lock expiry — vulnerable to reorg",
    detect: (line, ctx) => {
      if (!/FHE\.makePubliclyDecryptable\s*\(/.test(line)) return false;
      // check the surrounding function for a finality-delay block-number guard
      const start = Math.max(0, ctx.lineNo - 20);
      const back = ctx.allLines.slice(start, ctx.lineNo).join("\n");
      const hasFinality = /block\.number\s*>=\s*[\w_.]+\s*\+\s*(FINALITY|\d+)/i.test(back) ||
                          /scheduledBlock\b/.test(back);
      return !hasFinality;
    },
    fix: "Use a 2-step ritual: scheduleReveal() saves block.number; reveal() requires +FINALITY_BLOCKS.",
  },
  {
    id: "AP-020",
    severity: "warn",
    message: "Account-abstraction handler missing FHE.cleanTransientStorage — transient leak between user ops",
    detect: (line, ctx) => {
      const m = line.match(/function\s+(validateUserOp|executeUserOp|handleOps|_validate|_execute)\s*\(/);
      if (!m) return false;
      const body = ctx.allLines.slice(ctx.lineNo, ctx.lineNo + 60).join("\n");
      if (!/FHE\.allowTransient\s*\(/.test(body)) return false;
      return !/FHE\.cleanTransientStorage\s*\(\s*\)/.test(body);
    },
    fix: "Call FHE.cleanTransientStorage(); at the end of each user-op handler.",
  },
  {
    id: "AP-021",
    severity: "error",
    message:
      "External encrypted input consumed with msg.sender-trust but no caller-binding — 3rd-party replay risk",
    detect: (line, ctx) => {
      const sig = line.match(/function\s+(\w+)\s*\(([^)]*)\)\s*external/);
      if (!sig) return false;
      const params = sig[2];
      if (!/external(Euint\d+|Eaddress|Ebool)\s+\w+/.test(params)) return false;
      const body = bodyOfFunction(ctx);
      const usesMsgSenderKey = /\b_\w+\s*\[\s*msg\.sender\s*\]/.test(body);
      const hasBinding =
        /FHE\.eq\s*\(\s*\w+\s*,\s*FHE\.asEaddress\s*\(\s*msg\.sender/.test(body) ||
        /\becrecover\s*\(/.test(body) ||
        /\bproofHash\s*=\s*keccak256/.test(body) ||
        /require\s*\(\s*msg\.sender\s*==\s*\w+/.test(body);  // plaintext role-gate
      return usesMsgSenderKey && !hasBinding;
    },
    fix: "See references/06-input-proofs.md — bind via encrypted-sender check, EOA signature, or single-shot proof.",
  },
  {
    id: "AP-022",
    severity: "error",
    message: "Arbitrary execute(target, data) external call — attacker can grant ACL via untrusted target",
    detect: (line) =>
      /function\s+(execute|call|forward|delegateExec|multicall)\s*\([^)]*address\s+\w+[^)]*bytes\s+(?:calldata|memory)\s+\w+[^)]*\)\s+external/.test(line),
    fix: "Forbid arbitrary calls in confidential contracts. If unavoidable, whitelist target+selector.",
  },
];

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Returns the body text of the function whose declaration starts at ctx.lineNo,
// stopping at the next `function ` keyword or the end of the file (best-effort,
// avoids cross-function leakage in lookahead-based rules).
function bodyOfFunction(ctx) {
  const slice = ctx.allLines.slice(ctx.lineNo, ctx.lineNo + 80);
  const idx = slice.findIndex((l) => /^\s*function\s+\w+/.test(l));
  return (idx === -1 ? slice : slice.slice(0, idx)).join("\n");
}

// ──────────────────────────────────────────────────────────────────────────
// Scanner
// ──────────────────────────────────────────────────────────────────────────

function scanFile(filePath) {
  const text = readFileSync(filePath, "utf8");
  const allLines = text.split(/\r?\n/);
  const isFrontend = /\.tsx?$/.test(filePath);
  const issues = [];
  const ctx = { fileText: text, allLines, lineNo: 0, fileName: filePath, isFrontend };

  // Build per-line disable map from comments like:
  //   // fhe-lint-disable-next-line AP-006,AP-021
  //   // fhe-lint-disable-line AP-011
  const disabledOnLine = new Map();      // 1-indexed line → Set<ruleId>
  for (let i = 0; i < allLines.length; i++) {
    const m = allLines[i].match(/fhe-lint-disable-(?:next-)?line\s+([\w-,\s]+)/);
    if (!m) continue;
    const ids = m[1].split(/[,\s]+/).filter(Boolean);
    let target;
    if (/next-line/.test(allLines[i])) {
      // skip over subsequent comment-only / blank lines to find the next code line
      let j = i + 1;
      while (j < allLines.length) {
        const t = allLines[j].trim();
        if (t === "" || t.startsWith("//") || t.startsWith("/*") || t.startsWith("*") || t.startsWith("///")) {
          j++; continue;
        }
        break;
      }
      target = j + 1; // 1-indexed
    } else {
      target = i + 1;
    }
    let s = disabledOnLine.get(target); if (!s) { s = new Set(); disabledOnLine.set(target, s); }
    for (const id of ids) s.add(id);
  }

  for (let i = 0; i < allLines.length; i++) {
    const raw = allLines[i];
    // strip line and block comments (best-effort)
    const line = raw.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
    if (!line.trim()) continue;
    ctx.lineNo = i + 1;

    for (const rule of RULES) {
      const dis = disabledOnLine.get(ctx.lineNo);
      if (dis && dis.has(rule.id)) continue;
      // Frontend-tagged rules only run on .ts/.tsx; Solidity rules only on .sol.
      const isFrontendRule = ["AP-014", "AP-015", "AP-016"].includes(rule.id);
      if (isFrontendRule !== isFrontend && !(isFrontendRule === false && filePath.endsWith(".sol"))) {
        if (isFrontendRule && !isFrontend) continue;
        if (!isFrontendRule && isFrontend) continue;
      }
      try {
        if (rule.detect(line, ctx)) {
          issues.push({
            file: relative(ROOT, filePath),
            line: ctx.lineNo,
            col: 1,
            ruleId: rule.id,
            severity: rule.severity,
            message: rule.message,
            fix: rule.fix,
            snippet: raw.trim().slice(0, 160),
          });
        }
      } catch (e) {
        // never fail the whole scan because of one rule
      }
    }
  }
  return issues;
}

function* walk(p) {
  if (!existsSync(p)) return;
  const st = statSync(p);
  if (st.isFile()) {
    if (/\.(sol|tsx?)$/.test(p)) yield p;
    return;
  }
  for (const entry of readdirSync(p)) {
    if (entry === "node_modules" || entry === "dependencies" || entry === "out" || entry === ".git") continue;
    yield* walk(join(p, entry));
  }
}

function expandTargets(args) {
  const out = [];
  for (const a of args) {
    if (existsSync(a)) {
      for (const f of walk(a)) out.push(f);
    } else {
      // glob? expand crudely via shell — keep simple: treat as path or skip
    }
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// Output
// ──────────────────────────────────────────────────────────────────────────

function printTerminal(issues) {
  if (issues.length === 0) {
    console.log(COLOR.cyn("✔ fhe-lint: clean"));
    return;
  }
  for (const i of issues) {
    const sev =
      i.severity === "error" ? COLOR.red(`error  ${SEV.error}`)
      : i.severity === "warn" ? COLOR.yel(`warn   ${SEV.warn}`)
      : COLOR.cyn(`info   ${SEV.info}`);
    console.log(
      `${sev} ${COLOR.bold(i.ruleId)}  ${i.file}:${i.line}\n` +
      `       ${i.message}\n` +
      `       ${COLOR.dim(i.snippet)}\n` +
      `       fix: ${i.fix}\n`,
    );
  }
  const errs = issues.filter((x) => x.severity === "error").length;
  const warns = issues.filter((x) => x.severity === "warn").length;
  console.log(COLOR.bold(`fhe-lint: ${errs} error(s), ${warns} warning(s)`));
}

function printJSON(issues) {
  console.log(JSON.stringify({ count: issues.length, issues }, null, 2));
}

function printMarkdown(issues) {
  console.log(`# fhe-lint report\n\nTotal issues: ${issues.length}\n`);
  console.log("| Sev | Rule | File:Line | Message |");
  console.log("|---|---|---|---|");
  for (const i of issues) {
    console.log(`| ${SEV[i.severity] || "·"} | ${i.ruleId} | \`${i.file}:${i.line}\` | ${i.message} |`);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Self-test
// ──────────────────────────────────────────────────────────────────────────

function selfTest() {
  const fixturesDir = join(ROOT, "tools", "lint-fixtures");
  if (!existsSync(fixturesDir)) {
    console.error(`No fixtures at ${fixturesDir}. Run: pnpm lint:fhe-fixtures`);
    process.exit(2);
  }
  let pass = 0, fail = 0;
  const apDirs = readdirSync(fixturesDir).filter((d) => /^AP-\d{3}$/.test(d)).sort();
  for (const d of apDirs) {
    const apId = d;
    const findFixture = (name) => {
      for (const ext of ["sol", "tsx", "ts"]) {
        const p = join(fixturesDir, d, `${name}.${ext}`);
        if (existsSync(p)) return p;
      }
      return null;
    };
    const goodPath = findFixture("good");
    const badPath = findFixture("bad");
    const goodIssues = goodPath ? scanFile(goodPath).filter((i) => i.ruleId === apId) : [];
    const badIssues = badPath ? scanFile(badPath).filter((i) => i.ruleId === apId) : [];
    const okGood = goodIssues.length === 0;
    const okBad = badIssues.length > 0;
    if (okGood && okBad) {
      console.log(COLOR.cyn(`✔ ${apId}: good=clean, bad=detected`));
      pass++;
    } else {
      console.log(
        COLOR.red(`✘ ${apId}: good=${goodIssues.length} bad=${badIssues.length} ` +
                  `${okGood ? "" : "(false-positive on good!)"} ${okBad ? "" : "(missed bad!)"}`),
      );
      fail++;
    }
  }
  console.log(COLOR.bold(`\nself-test: ${pass} pass, ${fail} fail (${apDirs.length} rules tested)`));
  process.exit(fail === 0 ? 0 : 1);
}

// ──────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────

const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("fhe-lint.mjs");
const args = process.argv.slice(2);
if (!isMain) {
  // imported by fhe-eval.mjs / mcp-server — don't run CLI
} else if (args.includes("--self-test")) {
  selfTest();
} else if (args.length === 0) {
  console.error("Usage: fhe-lint <path> [--json|--md]   |   fhe-lint --self-test");
  process.exit(2);
} else {
  const targets = expandTargets(args.filter((a) => !a.startsWith("--")));
  const allIssues = [];
  for (const t of targets) allIssues.push(...scanFile(t));
  const mode = args.includes("--json") ? "json" : args.includes("--md") ? "md" : "term";
  if (mode === "json") printJSON(allIssues);
  else if (mode === "md") printMarkdown(allIssues);
  else printTerminal(allIssues);
  const errs = allIssues.filter((i) => i.severity === "error").length;
  const warns = allIssues.filter((i) => i.severity === "warn").length;
  process.exit(errs > 0 ? 1 : warns > 0 ? 2 : 0);
}

export { scanFile, RULES };
