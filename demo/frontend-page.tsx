// Drop into packages/nextjs/app/group-buy/page.tsx
//
// This is the demo frontend for ConfidentialGroupBuy: a 3-wallet pledge UI
// + creator dashboard. Talks to the deployed contract via wagmi + the
// @zama-fhe/react-sdk hooks already wired up by DappWrapperWithProviders.
//
// Setup (after deployment):
//   1. Run: pnpm generate            # emits packages/nextjs/contracts/ConfidentialGroupBuy.ts
//   2. Copy this file to:            packages/nextjs/app/group-buy/page.tsx
//   3. Open:                         http://localhost:3000/group-buy

"use client";

import { useCallback, useMemo, useState } from "react";
import { useEncrypt, useUserDecrypt, useAllow, useIsAllowed, usePublicDecrypt } from "@zama-fhe/react-sdk";
import { ZERO_HANDLE } from "@zama-fhe/sdk";
import { bytesToHex } from "viem";
import { useAccount, useChainId, useReadContract, useWriteContract } from "wagmi";
import { ConfidentialGroupBuy } from "~~/contracts/ConfidentialGroupBuy";

// Sepolia deployment addresses. Override via env vars if redeploying.
const TOKEN_ADDRESS = (process.env.NEXT_PUBLIC_CUSD_ADDRESS
  ?? "0x9Ab7912a600049De984E4C79AfC90E34eE17c08f") as `0x${string}`;
const GROUPBUY_ADDRESS = (process.env.NEXT_PUBLIC_GROUPBUY_ADDRESS
  ?? "0xcb6891DfaEcc2F5C54d10668fbf38011Fc4ffC9F") as `0x${string}`;
import { RainbowKitCustomConnectButton } from "~~/components/helper/RainbowKitCustomConnectButton";
import { deploymentFor } from "~~/utils/contract";

const button =
  "px-4 py-2 font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
const primary = `${button} bg-yellow-400 text-black hover:bg-yellow-500`;
const secondary = `${button} bg-black text-white hover:bg-gray-800`;
const card = "bg-gray-50 p-6 rounded-none shadow-md mb-6";

export default function GroupBuyPage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const buy = useMemo(() => deploymentFor(ConfidentialGroupBuy, chainId), [chainId]);
  const [pledgeInput, setPledgeInput] = useState<string>("100000");
  const [msg, setMsg] = useState<string>("");

  const encrypt = useEncrypt();
  const { writeContractAsync } = useWriteContract();

  // ── Read public state ──
  const goalRead = useReadContract({
    address: buy?.address, abi: buy?.abi, functionName: "goalAmount" as const,
    query: { enabled: !!buy?.address },
  });
  const finalizedRead = useReadContract({
    address: buy?.address, abi: buy?.abi, functionName: "finalized" as const,
    query: { enabled: !!buy?.address, refetchInterval: 5000 },
  });
  const revealedRead = useReadContract({
    address: buy?.address, abi: buy?.abi, functionName: "revealedTotal" as const,
    query: { enabled: !!buy?.address && !!finalizedRead.data, refetchInterval: 5000 },
  });
  const myContribRead = useReadContract({
    address: buy?.address, abi: buy?.abi, functionName: "getMyContribution" as const,
    account: address,
    query: { enabled: isConnected && !!buy?.address },
  });

  // ── Per-backer decrypt (own contribution) ──
  const myHandle = (myContribRead.data as `0x${string}` | undefined) ?? undefined;
  const handles = useMemo(
    () =>
      myHandle && myHandle !== ZERO_HANDLE && buy?.address
        ? [{ handle: myHandle, contractAddress: buy.address }]
        : [],
    [myHandle, buy?.address],
  );
  const { mutate: allow, isPending: isAllowing } = useAllow();
  const { data: isAllowed } = useIsAllowed({
    contractAddresses: buy?.address ? [buy.address] : [],
  });
  const [decryptEnabled, setDecryptEnabled] = useState(false);
  const decrypt = useUserDecrypt({ handles }, { enabled: decryptEnabled && !!isAllowed });
  const myContribClear = useMemo(
    () => (myHandle && decrypt.data ? decrypt.data[myHandle] : undefined),
    [myHandle, decrypt.data],
  );

  // ── Pledge action ──
  const onPledge = useCallback(async () => {
    if (!buy?.address || !address) return;
    setMsg("Encrypting...");
    // IMPORTANT: bind the proof to the TOKEN address (not the buy address),
    // because token.confidentialTransferFrom is the contract that calls
    // FHE.fromExternal — proofs are bound to (callee, encrypter).
    const enc = await encrypt.mutateAsync({
      values: [{ value: BigInt(pledgeInput || "0"), type: "euint64" }],
      contractAddress: TOKEN_ADDRESS,
      userAddress: address,
    });
    setMsg("Submitting pledge...");
    await writeContractAsync({
      address: buy.address, abi: buy.abi, functionName: "pledge",
      args: [bytesToHex(enc.handles[0]!), bytesToHex(enc.inputProof)],
      gas: 15_000_000n,
    });
    setMsg("Pledged!");
    myContribRead.refetch();
  }, [buy, address, pledgeInput, encrypt, writeContractAsync, myContribRead]);

  // ── Decrypt own ──
  const onDecryptMine = useCallback(() => {
    if (!buy?.address) return;
    setDecryptEnabled(true);
    if (!isAllowed) allow([buy.address]);
  }, [buy, isAllowed, allow]);

  // ── Finalize (creator action, post-deadline) ──
  const onFinalize = useCallback(async () => {
    if (!buy?.address) return;
    setMsg("Requesting finalisation...");
    await writeContractAsync({
      address: buy.address, abi: buy.abi, functionName: "requestFinalization", args: [],
      gas: 5_000_000n,
    });
    setMsg("Finalisation requested. Waiting for relayer callback (poll for 'finalized')...");
  }, [buy, writeContractAsync]);

  if (!isConnected) {
    return (
      <div className="max-w-2xl mx-auto p-8 text-center">
        <h1 className="text-2xl font-bold mb-4">Confidential Group Buy</h1>
        <p className="mb-4 text-gray-700">Connect your wallet to pledge.</p>
        <RainbowKitCustomConnectButton />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">🎯 Confidential Group Buy</h1>

      <div className={card}>
        <h2 className="font-bold mb-2">Campaign</h2>
        <p>Goal: <span className="font-mono">{goalRead.data?.toString() ?? "—"}</span> cUSD</p>
        <p>Status: {finalizedRead.data ? "✅ Finalised" : "⏳ Open"}</p>
        {finalizedRead.data && (
          <p>Revealed total: <span className="font-mono">{revealedRead.data?.toString() ?? "—"}</span> cUSD</p>
        )}
        <p>Contract: <span className="font-mono text-xs">{buy?.address ?? "(not deployed)"}</span></p>
      </div>

      <div className={card}>
        <h2 className="font-bold mb-2">Your pledge</h2>
        <div className="flex gap-2 mb-3">
          <input
            type="number"
            value={pledgeInput}
            onChange={(e) => setPledgeInput(e.target.value)}
            className="border border-gray-300 px-3 py-2 flex-1"
            placeholder="amount in cUSD base units"
          />
          <button onClick={onPledge} className={primary} disabled={!buy?.address}>
            🔐 Pledge (encrypted)
          </button>
        </div>
        <div className="text-sm text-gray-600 mb-3">
          Your handle: <span className="font-mono">{myHandle ?? "—"}</span>
        </div>
        <button onClick={onDecryptMine} className={secondary}
                disabled={!myHandle || myHandle === ZERO_HANDLE || isAllowing || decrypt.isFetching}>
          {decrypt.isFetching ? "⏳ Decrypting..."
            : myContribClear !== undefined ? `✅ Mine: ${myContribClear.toString()}`
            : "🔓 Decrypt my contribution"}
        </button>
      </div>

      <div className={card}>
        <h2 className="font-bold mb-2">Creator actions</h2>
        <p className="text-sm text-gray-600 mb-3">
          After the deadline, anyone can request finalisation. The relayer
          decrypts the encrypted total off-chain and posts the cleartext back
          via callback. Only then does <code>finalized = true</code> and
          <code>goalMet</code> become readable.
        </p>
        <button onClick={onFinalize} className={primary} disabled={finalizedRead.data}>
          ⚡ Request finalisation
        </button>
      </div>

      {msg && (
        <div className={card}>
          <p className="text-sm">{msg}</p>
        </div>
      )}
    </div>
  );
}
