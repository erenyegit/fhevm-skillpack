# 08 — Frontend with `@zama-fhe/sdk` + `@zama-fhe/react-sdk` v3

## Contents

- Provider wiring (Cleartext vs Web)
- Core hooks
- Encrypt → write pattern
- Decrypt (user + public) pattern
- Authorization (EIP-712) flow
- Frontend anti-patterns

## Provider wiring

The `@zama-fhe/react-sdk` `ZamaProvider` instantiates a single SDK instance
for the entire app. Pick the relayer:

```tsx
// app/providers.tsx
"use client";
import { ZamaProvider } from "@zama-fhe/react-sdk";
import { RelayerCleartext, RelayerWeb } from "@zama-fhe/sdk";

export function Providers({ children }: { children: React.ReactNode }) {
  const relayer =
    process.env.NEXT_PUBLIC_USE_CLEARTEXT === "1"
      ? new RelayerCleartext({ rpcUrl: "http://127.0.0.1:8545" })
      : new RelayerWeb(); // pulls FHE crypto from Zama CDN
  return <ZamaProvider relayer={relayer}>{children}</ZamaProvider>;
}
```

`RelayerCleartext` reads plaintext directly from the local anvil cleartext
host. **Dev only — never ship to production.** `RelayerWeb` spins up a Web
Worker and pulls FHE crypto from `cdn.zama.ai`.

## Core hooks

```ts
import {
  useEncrypt,
  useUserDecrypt,
  usePublicDecrypt,
  useAllow,
  useIsAllowed,
} from "@zama-fhe/react-sdk";
```

| Hook               | Purpose                                                                |
| ------------------ | ---------------------------------------------------------------------- |
| `useEncrypt`       | Build `externalEuintXX` + proof from plaintext                         |
| `useUserDecrypt`   | React-Query that user-decrypts a handle (auto re-runs on input change) |
| `usePublicDecrypt` | Decrypt a `makePubliclyDecryptable` handle                             |
| `useAllow`         | Generate FHE keypair + EIP-712 signature granting decryption           |
| `useIsAllowed`     | Gate — is the current user authorized for these contracts?             |

## Encrypt → write

```tsx
const { mutateAsync: encrypt } = useEncrypt();
const { writeContractAsync } = useWriteContract();

async function deposit(amount: bigint) {
  const enc = await encrypt({
    values: [{ value: amount, type: "euint64" }],
    contractAddress: token.address,
    userAddress: address,
  });
  await writeContractAsync({
    address: token.address,
    abi: token.abi,
    functionName: "deposit",
    args: [bytesToHex(enc.handles[0]!), bytesToHex(enc.inputProof)],
    gas: 15_000_000n, // FHE ops are gas-intensive
  });
}
```

Cap `gas` below Sepolia's block gas limit (16 777 216). Default wagmi
estimation will under-shoot for `mul`/`div` heavy paths.

## User-decrypt

```tsx
const decryptHandles = useMemo(
  () =>
    handle && handle !== ZERO_HANDLE
      ? [{ handle: handle as `0x${string}`, contractAddress: token.address }]
      : [],
  [handle, token.address],
);

const { mutate: allow } = useAllow();
const { data: isAllowed } = useIsAllowed({ contractAddresses: [token.address] });

const [decryptEnabled, setDecryptEnabled] = useState(false);
const decrypt = useUserDecrypt(
  { handles: decryptHandles },
  { enabled: decryptEnabled && !!isAllowed },
);

const plain = decrypt.data?.[handle as `0x${string}`];
```

Flow: button → `setDecryptEnabled(true)` → if not authorized,
`allow([token.address])` → `useIsAllowed` flips to true → `useUserDecrypt`
fires → `decrypt.data` populates with plaintexts.

## Public-decrypt

For values marked with `FHE.makePubliclyDecryptable`:

```tsx
const { data: tally } = usePublicDecrypt({
  handles: [{ handle: tallyHandle, contractAddress: vote.address }],
});
```

No authorization needed.

## Reading encrypted state

Encrypted state is read via wagmi's `useReadContract` like any other state.
The returned value is a 32-byte handle (`0x...`). Pass that handle to
`useUserDecrypt` or `usePublicDecrypt`.

```tsx
const { data: handle } = useReadContract({
  address: token.address,
  abi: token.abi,
  functionName: "balanceOf",
  args: [address],
});
```

If the handle is `ZERO_HANDLE` the slot was never written; treat as 0.

## Frontend anti-patterns

- **AP-014 `createInstance` per render.** Always instantiate via `ZamaProvider`.
- **AP-015 EIP-712 sig in `localStorage`.** Keep in React-Query / in-memory.
  The SDK does this internally — don't manually persist `useAllow` output.
- **AP-016 Decrypted plaintext in URL.** Use component state only.
- **Missing `enabled` flag on `useUserDecrypt`.** Without `enabled` the
  decrypt fires on mount and burns relayer quota for handles the user
  hasn't asked to decrypt.
- **Stale handle after write.** After a write tx, call `refetch()` on the
  read query before triggering decrypt; otherwise the user sees the old value.

## Events for UX

```ts
import { ZamaSDKEvents } from "@zama-fhe/sdk";

window.addEventListener(ZamaSDKEvents.CredentialsCached, () => setMessage("Ready..."));
window.addEventListener(ZamaSDKEvents.DecryptEnd, () => setMessage("Done!"));
```

Use these to drive optimistic-UI states; the React-Query `isFetching` flag
also works but doesn't distinguish between KMS quorum and crypto stages.

## Relayer SLA

The Sepolia FHEVM relayer typically responds in **30 s – 2 min** for both
public-decryption callbacks and user-decrypt requests, but there is no
formal SLA. We have observed >20-min latency during periods of relayer
degradation. **Design UX around delayed/missing callbacks:** show timeout
warnings (e.g., "still waiting for relayer after 5 min — try again
shortly"), poll status from the contract rather than relying on event
subscriptions only, and give users a clear path to retry.
