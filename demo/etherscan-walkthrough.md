# Etherscan walkthrough (for the demo video)

What to point to on the pledge transaction in the 2:30 – 2:50 window.

## URL after deploy
`https://sepolia.etherscan.io/address/<CONFIDENTIAL_GROUP_BUY_ADDRESS>`

Open the **Transactions** tab and pick the most recent `pledge` call.

## What to highlight on screen

1. **Function called:** `pledge(externalEuint64,bytes)` — visible in the
   "Function" badge.
2. **Input Data:** click "View Input As" → "Default" — the full ciphertext
   handle (32 bytes) and the input proof (variable-length bytes) are shown
   as hex. Point to the `0x...` blob and say "this is the encrypted pledge
   amount, no plaintext".
3. **Decoded inputs:** the externalEuint64 displays as a `bytes32` — there
   is no human-readable amount anywhere on the page.
4. **Logs:** the `Pledged` event emits the *transferred* handle bytes32 and
   the backer address. The handle is opaque.
5. **State:** click "Read Contract". Call `goalAmount` — public uint64
   visible. Call `getEncryptedTotal` from the creator wallet — returns a
   handle. Call from a non-creator wallet — same handle returned, but ACL
   prevents off-chain decryption.

## Talking points (cue card)

> "The function is `pledge(externalEuint64, bytes)`. The input data is
> opaque ciphertext — you can read the bytes but you can't read the amount.
> The event emits a handle, not a value. The encrypted total is a handle
> too — only the creator was granted decryption access after the goal
> was met. Compare that to a regular ERC-20 transfer where the amount is
> right there in the calldata."

## Failure mode to AVOID on camera

Do **not** click the contract's `revealedTotal()` getter on a campaign
that has been finalised — the cleartext total will appear and undermine
the privacy story. Either film before finalisation, or use a contract
deployment that's still under-funded.
