# Single-shot Cursor prompt for the demo video

Paste verbatim into Composer. No edits. No follow-up.

---

Build a confidential group-buy contract on FHEVM (Zama, Solidity 0.8.27,
Foundry + forge-fhevm). Backers pledge encrypted amounts in a confidential
ERC-7984-style token (cUSD, euint64 balances). When the encrypted total
reaches a public goal amount, decrypt the total via the relayer
(makePubliclyDecryptable + checkSignatures pattern with delete-before-effects
replay defense), and release funds to the creator. Each backer's individual
pledge must remain private forever — only the backer themselves can decrypt
their own contribution. Apply ACL on every storage write, use the
*effective* transferred amount in the pledge accounting (silent-failure
safe — see OpenZeppelin Fabry vulnerability #5), and add a 12-block
finality delay between deadline and reveal (Fabry vulnerability #6).

Deliverables:
- `packages/foundry/src/ConfidentialGroupBuy.sol`
- `packages/foundry/test/ConfidentialGroupBuy.t.sol` with five tests:
  happy_path (3 backers reach goal), replay_defense (callback replay
  rejected), per_backer_decrypt_isolation (alice cannot decrypt bob's
  pledge), under_funded (goalMet=false on insufficient pledges),
  silent_failure_clamp (over-pledger with insufficient cUSD only contributes
  what they actually had).
- `packages/foundry/script/DeployConfidentialGroupBuy.s.sol`
- `packages/nextjs/app/group-buy/page.tsx` integrating with wagmi +
  @zama-fhe/react-sdk v3 hooks (useEncrypt, useUserDecrypt, useAllow).

Run `pnpm lint:fhe` before declaring done — fix any AP-* errors. Then
`pnpm contracts:test`. Both must be clean.
