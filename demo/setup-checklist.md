# Pre-shoot setup checklist

## 24h before

- [ ] `git pull` and verify `pnpm install` succeeds clean
- [ ] `pnpm contracts:install` (forge soldeer install) succeeds
- [ ] `pnpm contracts:test` 5/5 PASS for `ConfidentialGroupBuy.t.sol`
- [ ] `pnpm lint:fhe packages/foundry/src` returns clean
- [ ] `node tools/fhe-lint.mjs --self-test` 22/22 PASS
- [ ] `.env` populated with `DEPLOYER_PRIVATE_KEY`, `SEPOLIA_RPC_URL`,
      `ETHERSCAN_API_KEY`
- [ ] `packages/nextjs/.env.local` has `NEXT_PUBLIC_ALCHEMY_API_KEY`
- [ ] Three test wallets in MetaMask, each with **0.1 Sepolia ETH** + at
      least 500_000 base-units of the demo cUSD token (mint via
      `MockCToken.mint` or your deployment script)
- [ ] Cursor installed; skill copied/symlinked to
      `~/.cursor/skills/fhevm-skillpack`
- [ ] OBS/Loom test recording 30 seconds, audio + video confirmed

## 1h before

- [ ] Close every other browser tab. Only Etherscan + localhost:3000 open
- [ ] `pnpm chain` running in terminal 1 (anvil + cleartext FHEVM host)
- [ ] `pnpm start` running in terminal 2 (`localhost:3000`)
- [ ] Cursor open with `fhevm-skillpack/` as the workspace root
- [ ] `demo/cursor-prompt.md` open in a side-by-side window for paste
- [ ] Three MetaMask windows pre-positioned (one per wallet) — labelled
      Alice / Bob / Carol
- [ ] Mic on, headphones unplugged from the recording machine, notifications
      silenced (System → Focus → Do Not Disturb)

## Take-1 readiness

- [ ] Open `demo/VIDEO-SCRIPT.md` on a second monitor for cue cards
- [ ] Test the "decrypt my contribution" button works end-to-end on one
      wallet (warm the relayer cache)
- [ ] Practice scrolling speed for the 1:15–1:45 contract walkthrough
      (you have 30s for ~150 lines — 5 lines/second peak)
