# Demo video — 3-minute shooting script

Total: **3:00**. Filmed in OBS or Loom. One screen, mic on. Two browser
tabs (Etherscan + http://localhost:3000/group-buy), one terminal, Cursor IDE
on the left half.

Aim: show that an agent armed with `fhevm-skillpack` builds a real
confidential-finance app in one prompt, with zero anti-patterns,
compiles + tests + deploys to Sepolia, and surfaces the privacy property
in the browser.

| Time   | Scene | Action | Voice-over (verbatim) |
|--------|-------|--------|------------------------|
| 0:00 – 0:15 | Cold open | Black screen → fade in to a Kickstarter screenshot of a campaign with the pledge total + per-backer names visible. | "Crowdfunding leaks two things you'd want to keep private: who pledged, and how much. On-chain crowdfunding leaks the same things to anyone with a block explorer. We're going to fix that in the next three minutes." |
| 0:15 – 0:30 | Cursor IDE | Cursor IDE open on `fhevm-skillpack` repo. Show `~/.cursor/skills/fhevm-skillpack` in the file tree. Hover over `SKILL.md`. | "Cursor's loaded the fhevm-skillpack — a Skills-format pack with a 22-rule AST linter, an MCP server, and a 6-recipe library." |
| 0:30 – 1:15 | Single prompt | Open a fresh Composer chat. Paste the prompt from `demo/cursor-prompt.md` verbatim. Hit send. **Stay silent for 25 seconds** while Cursor writes. | (silence — let the agent work) |
| 1:15 – 1:45 | Contract output | Cursor produces `ConfidentialGroupBuy.sol` + `.t.sol`. Scroll through the contract. Highlight `delete _pendingFinalization[id]` and `FHE.checkSignatures` (replay defense), `FHE.allow(_contributions[msg.sender], msg.sender)` (per-backer ACL), and the `FINALITY_BLOCKS` reveal delay. | "Notice three things the agent got right because of the skill: it deletes the pending entry before any external call, so the relayer can't replay the callback. It grants per-backer ACL so each pledger sees only their own amount. And it doesn't reveal the total until the deadline plus a finality delay." |
| 1:45 – 2:00 | Linter side-by-side | Switch to terminal split. Left: `pnpm lint:fhe packages/foundry/src/ConfidentialGroupBuy.sol` → `✔ clean`. Right (small): a hypothetical regex-based competitor running on the same file showing only "no `if` statements detected." | "On the left: our AST linter, 22 rules, finds zero anti-patterns. On the right, the regex linter that ships with most existing skills caught one syntactic issue and missed the rest." |
| 2:00 – 2:30 | Tests + deploy | `pnpm contracts:test` → `Running 5 tests for test/ConfidentialGroupBuy.t.sol:ConfidentialGroupBuyTest [PASS]`. Then `pnpm deploy:sepolia` (with `.env` pre-filled) → contract address printed. | "Five tests pass — including the replay-defense and per-backer-decrypt-isolation cases. Push to Sepolia." |
| 2:30 – 2:50 | Browser pledge | Switch to `localhost:3000/group-buy`. Three MetaMask wallets pre-loaded with cUSD. Backer 1 pledges 400, backer 2 pledges 350, backer 3 pledges 250. Show the encrypted handle changing in the UI. Open Etherscan and show the pledge transaction's input data — opaque ciphertext bytes. Switch back, click "Decrypt my contribution" — only the connected wallet's value shows. | "Three pledges, three different amounts. On Etherscan: opaque ciphertext, no leak. In the UI, each backer can only decrypt their own pledge." |
| 2:50 – 3:00 | Outro card | Black card: `fhevm-skillpack`<br>`github.com/erenyegit/fhevm-skillpack`<br>`Zama Bounty Track Season 2` | "fhevm-skillpack. Repo's in the description. Confidential finance, one prompt at a time." |

## Pre-shoot checklist
See `demo/setup-checklist.md`.

## Recording technical notes
- 1920×1080, 60fps, mp4
- Mic: clip-on or USB condenser, no compressor
- One take preferred; don't cut between scenes if possible (single-take
  flexes the agent's speed credibly)
- Don't speed up the "agent typing" phase — the silence is the point
- Add captions in post: most reviewers will watch muted

## Recommended music
None. Silence + typing sells the demo.
