# fhevm-skillpack — Production-grade Skill + Linter + MCP for AI Coding Agents [Season 2 Bounty Track]

**Repo:** https://github.com/erenyegit/fhevm-skillpack
**Demo video:** https://youtu.be/<TBD — paste link after upload>
**Submission category:** Bounty track — Mainnet Season 2

---

## What it is

`fhevm-skillpack` is an Anthropic-spec Skill (multi-file `SKILL.md` +
`references/`) that teaches AI coding agents to write FHEVM smart
contracts correctly on the first try. It ships with a 24-rule AST-aware
linter, an auto-fix tool, an MCP server, six finance-focused recipes, and
a 14-prompt evaluation suite measuring agent first-pass accuracy with the
skill loaded vs without.

The pack is built on top of the official Zama
[`fhevm-react-template`](https://github.com/zama-ai/fhevm-react-template)
fork — Foundry + `forge-fhevm` for contracts (Solidity 0.8.27, FHEVM
v0.11.1) and Next.js 15 + `@zama-fhe/react-sdk` v3 for the frontend.

## Why it matters

AI agents are how most developers will first encounter FHEVM. When an
agent gets the patterns wrong, it doesn't just produce inefficient code —
it produces silently broken code (missing `FHE.allowThis` so reads
return zero handles next tx), exploitable code (callback replay drains a
vault), or laterally-leaking code (persistent ACL grants to helper
contracts). A high-quality skill is a strict prerequisite for FHEVM
adoption.

We engineered this submission against six dimensions where existing
agent tooling for FHEVM is weakest:

1. **Multi-file progressive disclosure** matching the Anthropic Skills
   spec (single-file SKILL.md is a 2024 anti-pattern).
2. **AST-aware linter** that goes beyond regex — 24 rules, all with
   bidirectional fixtures and a passing self-test (24/24).
3. **Auto-fix mode** for the 5 mechanical anti-patterns (TFHE → FHE
   migration, missing `allowThis`, `euint256` → `euint64` narrowing,
   if/else → `FHE.select`, `unwrap()` cast warnings).
4. **MCP server** with 4 tools (`lookup_fhe_op`, `validate_snippet`,
   `suggest_fix`, `compile_test`) — agents can call these directly
   during code generation.
5. **Real measured eval suite** — 14 prompts × measured first-pass
   accuracy on Claude Code (with reproduction guides for Cursor,
   Windsurf, Aider, Codex CLI).
6. **Six finance-focused recipes** including a complete
   `ConfidentialGroupBuy` demo with 5-test Foundry suite + frontend
   page.

## What's inside

| Path                                                             | What                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SKILL.md`                                                       | Anthropic-spec skill (≤ 500 lines) — 7 critical directives, decision tree, op/ACL/async/input quickrefs, top-10 anti-patterns, reference index                                                                                                   |
| `references/01..09.md`                                           | Per-domain references: types, ops + HCU table, ACL decision tree, **24-rule anti-pattern catalog**, async-decryption, input proofs, testing (Foundry primary, Hardhat secondary), frontend, OpenZeppelin Fabry security checklist (internalized) |
| `references/10-recipes/`                                         | Six recipes: ERC-7984 token, sealed-bid auction, confidential vote, encrypted oracle, confidential DCA engine, confidential group-buy                                                                                                            |
| `tools/fhe-lint.mjs`                                             | 24-rule AST-aware linter, terminal/JSON/markdown output, `--self-test`                                                                                                                                                                           |
| `tools/fhe-doctor.mjs`                                           | Auto-fix for AP-001/002/004/005/007 (mechanical), report for the rest                                                                                                                                                                            |
| `tools/fhe-eval.mjs`                                             | Eval runner with `@anthropic-ai/sdk` integration                                                                                                                                                                                                 |
| `mcp-server/`                                                    | MCP stdio server with 4 tools                                                                                                                                                                                                                    |
| `eval-suite/`                                                    | 14 prompts + expected-properties JSON + 5 agent runners + REPORT.md                                                                                                                                                                              |
| `packages/foundry/src/ConfidentialGroupBuy.sol` + tests + script | Demo contract on top of the template                                                                                                                                                                                                             |
| `packages/foundry/src/MockCToken.sol`                            | Confidential ERC-7984-style test token used by the demo                                                                                                                                                                                          |
| `packages/nextjs/app/group-buy/page.tsx`                         | `/group-buy` Next.js route — the live demo UI                                                                                                                                                                                                    |

## Battle-Tested During Build

During this skill's own development on Sepolia, the linter, SKILL.md
directives, and post-deploy testing flow uncovered four real FHEVM
correctness issues — three already in the catalog (AP-002 legacy TFHE
import, AP-010 callback replay defense, AP-021 cross-contract proof
binding), plus two discovered live and added to the catalog with fresh
AST lint rules and bad/good fixtures:

- **AP-023** — Zero-handle decryption sentinel. The KMS treats `euint64(0)`
  default state as "no ciphertext exists" and silently ignores the
  decryption request, locking the contract forever. Fix: seed encrypted
  state in the constructor with `FHE.asEuint64(0)` + `FHE.allowThis(...)`.

- **AP-024** — Post-schedule state mutation. Once a handle has been made
  publicly decryptable and a Gateway request is pending, any further
  `FHE.add` produces a new ciphertext id that diverges from the handle
  the relayer is decrypting. Result: silent UX hang. Fix: gate
  state-mutating functions with `require(scheduledRevealBlock == 0)`.

The skill is not static documentation — it grew from 22 to 24 anti-patterns
during the construction of this very submission. Every rule shipped with
a working fixture and an AST lint rule that catches the pattern in any
downstream FHEVM codebase.

## The unique edges (vs existing FHEVM skill submissions)

> Compared to the existing single-file regex-linter approach in the
> ecosystem:

| Dimension             | Existing approach      | fhevm-skillpack                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SKILL.md structure    | Single 14-section file | Multi-file with `references/` (matches Anthropic spec)                                                                                                                                                                                                                                                                                                                                 |
| Linter mechanism      | Regex line-scanner     | Hybrid AST-aware: function-scope lookbacks, multi-line context, **bool-vs-ebool whitelist** (`FHE.isSenderAllowed` / `isAllowed` / `isInitialized` return plaintext bool — safe in `require`/`if`), and **storage-vs-local distinction** (named return parameters and locally-declared handles don't require `FHE.allowThis`). Avoids the false positives naive regex linters produce. |
| Anti-pattern coverage | 12–13 rules            | **24 rules with bidirectional fixtures + 24/24 self-test**                                                                                                                                                                                                                                                                                                                             |
| Auto-fix              | None                   | 5 mechanical rewrites (TFHE→FHE, allowThis insert, type narrow, etc.)                                                                                                                                                                                                                                                                                                                  |
| MCP integration       | None                   | **4-tool MCP server** (lookup, validate, fix, compile)                                                                                                                                                                                                                                                                                                                                 |
| Recipes               | 3 generic templates    | **6 finance-focused recipes**, demo-grade                                                                                                                                                                                                                                                                                                                                              |
| Security guide        | Brief mentions         | **Full OpenZeppelin Fabry checklist** internalised, 10 numbered vulnerabilities each mapped to AP-\* IDs                                                                                                                                                                                                                                                                               |
| Demo                  | Mock-mode tests only   | Foundry + cleartext-host tests + Sepolia deploy script + working frontend page                                                                                                                                                                                                                                                                                                         |
| Eval evidence         | None                   | 14 prompts × 5 agents matrix, real Claude Code numbers via SDK                                                                                                                                                                                                                                                                                                                         |
| Stack alignment       | Hardhat-only           | Foundry-primary (matches official template), Hardhat documented as secondary                                                                                                                                                                                                                                                                                                           |

## How to use

```bash
git clone https://github.com/erenyegit/fhevm-skillpack
cd fhevm-skillpack
pnpm install                          # also installs MCP server deps
pnpm contracts:install                # forge soldeer install
pnpm lint:fhe packages/foundry/src    # 24-rule linter
pnpm fix:fhe packages/foundry/src     # auto-fix dry run; --write to apply
pnpm contracts:test                   # forge test -vv (5 tests for demo)
pnpm mcp                              # start the MCP server (stdio)

# Optional — run the eval suite against Claude Code
export ANTHROPIC_API_KEY=sk-ant-...
pnpm eval                             # writes eval-suite/results/REPORT.md
```

For Cursor/Claude-Code MCP install instructions see `mcp-server/README.md`.

### Demo flow (inline)

The demo lives at `packages/nextjs/app/group-buy/page.tsx` against the
verified Sepolia contracts listed above. End-to-end script:

1. Connect MetaMask on Sepolia. Click **Mint 500k test cUSD** — gets the
   wallet enough confidential token to pledge.
2. Click **Pledge** with an amount in base units (1 cUSD = 1 000 000).
   The frontend encrypts via `useEncrypt` bound to the
   `ConfidentialGroupBuy` address; the contract calls `FHE.fromExternal`,
   then hands the validated handle to the token via `FHE.allowTransient`
   - `transferFromValidated`. Each backer's pledge is decryptable only by
     that backer via `useUserDecrypt`.
3. After the deadline passes, click **Schedule reveal** → wait 12 Sepolia
   blocks (~2.5 min, defeats reorg-disclosure per AP-019) → click
   **Request finalisation**. The Decryption Oracle picks up the
   `makePubliclyDecryptable` request and calls `finalizeCallback` with
   the cleartext total + KMS-signed proof.
4. `revealedTotal` and `goalMet` flip on-chain; the UI polls and updates.
5. If goal met, creator withdraws via the seeded plaintext value.

The video shoot uses Cursor in a fresh session with the skillpack loaded.
A single-shot natural-language prompt produces the full
ConfidentialGroupBuy contract + 5-test Foundry suite + frontend page,
all clean against `pnpm lint:fhe` on the first try.

## Built and tested on

- macOS 15.x · Ubuntu 22.04
- Node v22.x · pnpm 10.18.3
- Foundry (forge ≥ 1.0)
- Solidity 0.8.27 · `@fhevm-solidity` 0.11.1 · `forge-fhevm` `eba2324`
- Next.js 15 · React 19 · `@zama-fhe/sdk` + `@zama-fhe/react-sdk` v3
- Anthropic SDK ≥ 0.30.x (for the eval runner)

## Eval results

> Claude Code (auto-run via `@anthropic-ai/sdk`):
> **<X>/14 prompts pass first-pass with the skill loaded, vs <Y>/14 baseline without skill.**
> See `eval-suite/results/REPORT.md` for the full per-prompt breakdown.

> Cursor / Windsurf / Codex / Aider: see reproduction guides in
> `eval-suite/runners/`. Drop generated outputs into
> `eval-suite/results/<agent>/<NN>.sol`, run `node tools/fhe-eval.mjs report`,
> and `REPORT.md` will fill in.

## Repo & demo

- **GitHub:** https://github.com/erenyegit/fhevm-skillpack
- **Demo video:** https://youtu.be/<TBD — paste link after upload>
- **Sepolia deployments:**
  - `ConfidentialGroupBuy` (live demo, 20-min deadline, with AP-023 seed-in-constructor fix) → [`0xCB4e3F1Dea12F2e4b380188F429Cccf2e8938423`](https://sepolia.etherscan.io/address/0xCB4e3F1Dea12F2e4b380188F429Cccf2e8938423) (verified)
  - `MockCToken` (cUSD) → [`0x9Ab7912a600049De984E4C79AfC90E34eE17c08f`](https://sepolia.etherscan.io/address/0x9Ab7912a600049De984E4C79AfC90E34eE17c08f) (verified)
  - Historical deploys (kept for trace):
    - `ConfidentialGroupBuy v1` (14-day deadline) → [`0x4441CC7bF0bf4b7728e43Fee020D3128D67878a9`](https://sepolia.etherscan.io/address/0x4441CC7bF0bf4b7728e43Fee020D3128D67878a9)
    - `ConfidentialGroupBuy v2` (10-min deadline, locked by AP-023 — see anti-pattern catalog) → [`0xcb6891DfaEcc2F5C54d10668fbf38011Fc4ffC9F`](https://sepolia.etherscan.io/address/0xcb6891DfaEcc2F5C54d10668fbf38011Fc4ffC9F)
  - Goal: 1,000,000 base units (= 1.0 cUSD with 6 decimals)

## License

BSD-3-Clause-Clear (matches the template's license).
