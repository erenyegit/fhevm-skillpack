"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAllow, useEncrypt, useIsAllowed, useUserDecrypt } from "@zama-fhe/react-sdk";
import { ZERO_HANDLE, ZamaSDKEvents } from "@zama-fhe/sdk";
import { bytesToHex } from "viem";
import { useAccount, useChainId, useReadContract, useWriteContract } from "wagmi";
import { RainbowKitCustomConnectButton } from "~~/components/helper/RainbowKitCustomConnectButton";
import { ConfidentialGroupBuy } from "~~/contracts/ConfidentialGroupBuy";
import { MockCToken } from "~~/contracts/MockCToken";
import { deploymentFor } from "~~/utils/contract";

// Sepolia deployment defaults — override via .env.local if redeploying.
const TOKEN_ADDRESS = (process.env.NEXT_PUBLIC_CUSD_ADDRESS ??
  "0x9Ab7912a600049De984E4C79AfC90E34eE17c08f") as `0x${string}`;
const GROUPBUY_ADDRESS = (process.env.NEXT_PUBLIC_GROUPBUY_ADDRESS ??
  "0xcb6891DfaEcc2F5C54d10668fbf38011Fc4ffC9F") as `0x${string}`;

const buttonBase =
  "inline-flex items-center justify-center px-6 py-3 font-semibold shadow-lg transition-all duration-200 hover:scale-105 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 " +
  "disabled:opacity-50 disabled:pointer-events-none disabled:cursor-not-allowed";
const primaryButton = `${buttonBase} bg-[#FFD208] text-[#2D2D2D] hover:bg-[#A38025] focus-visible:ring-[#2D2D2D] cursor-pointer`;
const secondaryButton = `${buttonBase} bg-black text-[#F4F4F4] hover:bg-[#1F1F1F] focus-visible:ring-[#FFD208] cursor-pointer`;
const sectionClass = "bg-[#f4f4f4] shadow-lg p-6 mb-6 text-gray-900";
const titleClass = "font-bold text-gray-900 text-xl mb-4 border-b-1 border-gray-700 pb-2";

export default function GroupBuyPage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();

  // Resolve the contract objects for the connected chain. We override the
  // address with the env-var value so the same artifact ABI works whether the
  // user is on Sepolia or a different deployment.
  const buy = useMemo(() => {
    const base = deploymentFor(ConfidentialGroupBuy, chainId);
    return base ? { ...base, address: GROUPBUY_ADDRESS } : undefined;
  }, [chainId]);
  const token = useMemo(() => {
    const base = deploymentFor(MockCToken, chainId);
    return base ? { ...base, address: TOKEN_ADDRESS } : undefined;
  }, [chainId]);

  const [pledgeInput, setPledgeInput] = useState<string>("100000");
  const [message, setMessage] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const encrypt = useEncrypt();
  const { writeContractAsync } = useWriteContract();

  // ── Public reads ──
  const goalRead = useReadContract({
    address: buy?.address,
    abi: buy?.abi,
    functionName: "goalAmount" as const,
    query: { enabled: !!buy?.address },
  });
  const finalizedRead = useReadContract({
    address: buy?.address,
    abi: buy?.abi,
    functionName: "finalized" as const,
    query: { enabled: !!buy?.address, refetchInterval: 8000 },
  });
  const goalMetRead = useReadContract({
    address: buy?.address,
    abi: buy?.abi,
    functionName: "goalMet" as const,
    query: { enabled: !!buy?.address && !!finalizedRead.data },
  });
  const revealedRead = useReadContract({
    address: buy?.address,
    abi: buy?.abi,
    functionName: "revealedTotal" as const,
    query: { enabled: !!buy?.address && !!finalizedRead.data },
  });
  const deadlineRead = useReadContract({
    address: buy?.address,
    abi: buy?.abi,
    functionName: "deadline" as const,
    query: { enabled: !!buy?.address },
  });

  // ── Per-backer encrypted contribution handle ──
  const myContribRead = useReadContract({
    address: buy?.address,
    abi: buy?.abi,
    functionName: "getMyContribution" as const,
    account: address,
    query: { enabled: isConnected && !!buy?.address },
  });
  const myHandle = (myContribRead.data as `0x${string}` | undefined) ?? undefined;

  // ── User-decrypt for own contribution ──
  const decryptHandles = useMemo(
    () =>
      myHandle && myHandle !== ZERO_HANDLE && buy?.address ? [{ handle: myHandle, contractAddress: buy.address }] : [],
    [myHandle, buy?.address],
  );
  const { mutate: allow, isPending: isAllowing } = useAllow();
  const contractAddrForAllow = (buy?.address ?? "0x0") as `0x${string}`;
  const { data: isAllowed } = useIsAllowed({ contractAddresses: [contractAddrForAllow] });
  const [decryptEnabled, setDecryptEnabled] = useState(false);
  const decrypt = useUserDecrypt({ handles: decryptHandles }, { enabled: decryptEnabled && !!isAllowed });
  const myContribClear = useMemo(
    () => (myHandle && decrypt.data ? decrypt.data[myHandle] : undefined),
    [myHandle, decrypt.data],
  );

  // After finalisation the contract publishes `revealedTotal` as a
  // plaintext uint64 in the callback — that's the canonical public value.
  // No usePublicDecrypt needed here.

  useEffect(() => {
    const ctrl = new AbortController();
    window.addEventListener(ZamaSDKEvents.CredentialsCached, () => setMessage("Credentials ready, decrypting..."), {
      signal: ctrl.signal,
    });
    window.addEventListener(ZamaSDKEvents.DecryptEnd, () => setMessage("Decryption complete!"), {
      signal: ctrl.signal,
    });
    return () => ctrl.abort();
  }, []);

  // ── Pledge ──
  const onPledge = useCallback(async () => {
    if (!buy?.address || !address || !pledgeInput) return;
    try {
      setIsSubmitting(true);
      setMessage("Encrypting pledge amount...");
      const enc = await encrypt.mutateAsync({
        // Encryption MUST target the contract that calls FHE.fromExternal —
        // ConfidentialGroupBuy does that itself (then hands the validated
        // handle to the cUSD token via FHE.allowTransient).
        values: [{ value: BigInt(pledgeInput), type: "euint64" }],
        contractAddress: buy.address,
        userAddress: address,
      });
      setMessage("Submitting transaction...");
      await writeContractAsync({
        address: buy.address,
        abi: buy.abi,
        functionName: "pledge",
        args: [bytesToHex(enc.handles[0]!), bytesToHex(enc.inputProof)],
        gas: 15_000_000n,
      });
      setMessage("Pledge confirmed!");
      myContribRead.refetch();
    } catch (e) {
      setMessage(`Pledge failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsSubmitting(false);
    }
  }, [buy, address, pledgeInput, encrypt, writeContractAsync, myContribRead]);

  // ── Mint test cUSD (so backers can pledge) ──
  const onMintTest = useCallback(async () => {
    if (!token?.address || !address) return;
    try {
      setIsSubmitting(true);
      setMessage("Minting 500_000 test cUSD to your wallet...");
      const enc = await encrypt.mutateAsync({
        values: [{ value: 500_000n, type: "euint64" }],
        contractAddress: token.address,
        userAddress: address,
      });
      await writeContractAsync({
        address: token.address,
        abi: token.abi,
        functionName: "mint",
        args: [address, bytesToHex(enc.handles[0]!), bytesToHex(enc.inputProof)],
        gas: 5_000_000n,
      });
      setMessage("Minted 500_000 cUSD.");
    } catch (e) {
      setMessage(`Mint failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsSubmitting(false);
    }
  }, [token, address, encrypt, writeContractAsync]);

  const onDecryptMine = useCallback(() => {
    if (!buy?.address) return;
    setDecryptEnabled(true);
    if (!isAllowed) {
      setMessage("Authorising decryption...");
      allow([buy.address]);
    } else {
      setMessage("Starting decryption...");
    }
  }, [buy?.address, isAllowed, allow]);

  // ── Finalisation actions (anyone can call after deadline + finality delay) ──
  const onSchedule = useCallback(async () => {
    if (!buy?.address) return;
    setMessage("Scheduling finalisation...");
    await writeContractAsync({
      address: buy.address,
      abi: buy.abi,
      functionName: "scheduleFinalization",
      args: [],
    });
    setMessage("Scheduled. Wait 12 blocks for finality, then click Finalise.");
  }, [buy, writeContractAsync]);

  const onFinalize = useCallback(async () => {
    if (!buy?.address) return;
    setMessage("Requesting finalisation (relayer will decrypt total)...");
    await writeContractAsync({
      address: buy.address,
      abi: buy.abi,
      functionName: "requestFinalization",
      args: [],
    });
    setMessage("Finalisation requested. Relayer will call back shortly.");
  }, [buy, writeContractAsync]);

  if (!isConnected) {
    return (
      <div className="flex flex-col gap-8 items-center w-full px-3 md:px-0">
        <div className="max-w-3xl mx-auto p-6 text-gray-900">
          <h1 className="text-3xl font-bold mb-2 text-center">🎯 Confidential Group Buy</h1>
          <p className="text-center text-gray-700 mb-6">Connect your wallet to pledge.</p>
          <div className="flex justify-center">
            <RainbowKitCustomConnectButton />
          </div>
        </div>
      </div>
    );
  }

  const goalDisplay = (goalRead.data as bigint | undefined)?.toString() ?? "—";
  const revealedDisplay = (revealedRead.data as bigint | undefined)?.toString() ?? "—";
  const deadlineNum = deadlineRead.data as bigint | undefined;
  const deadlineDisplay = deadlineNum
    ? new Date(Number(deadlineNum) * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC"
    : "—";
  const isFinalized = !!finalizedRead.data;
  const isGoalMet = !!goalMetRead.data;

  return (
    <div className="flex flex-col gap-6 items-center w-full px-3 md:px-0">
      <div className="max-w-3xl w-full mx-auto p-6 text-gray-900">
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold">🎯 Confidential Group Buy</h1>
          <p className="text-gray-600">Encrypted pledges, public goal — only the total is revealed.</p>
        </div>

        <div className={sectionClass}>
          <h3 className={titleClass}>Campaign</h3>
          <div className="space-y-2 text-sm">
            <div>
              Goal: <span className="font-mono">{goalDisplay}</span> cUSD base units
            </div>
            <div>
              Deadline: <span className="font-mono">{deadlineDisplay}</span>
            </div>
            <div>Status: {isFinalized ? (isGoalMet ? "✅ Funded" : "⛔ Failed") : "⏳ Open"}</div>
            {isFinalized && (
              <div>
                Revealed total: <span className="font-mono">{revealedDisplay}</span>
              </div>
            )}
            <div className="text-xs text-gray-600 break-all">Contract: {buy?.address ?? "(not deployed)"}</div>
            <div className="text-xs text-gray-600 break-all">cUSD token: {token?.address ?? "(not deployed)"}</div>
          </div>
        </div>

        <div className={sectionClass}>
          <h3 className={titleClass}>Your pledge</h3>
          <div className="flex gap-2 mb-3">
            <input
              type="number"
              value={pledgeInput}
              onChange={e => setPledgeInput(e.target.value)}
              className="border border-gray-300 px-3 py-2 flex-1 font-mono"
              placeholder="amount in cUSD base units"
            />
            <button onClick={onPledge} className={primaryButton} disabled={isSubmitting || !buy?.address}>
              🔐 Pledge
            </button>
          </div>
          <div className="text-sm text-gray-600 mb-3 break-all">
            Your handle: <span className="font-mono">{myHandle ?? "—"}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
              onClick={onDecryptMine}
              className={secondaryButton}
              disabled={!myHandle || myHandle === ZERO_HANDLE || isAllowing || decrypt.isFetching}
            >
              {decrypt.isFetching
                ? "⏳ Decrypting..."
                : myContribClear !== undefined
                  ? `✅ Mine: ${myContribClear.toString()}`
                  : "🔓 Decrypt my contribution"}
            </button>
            <button onClick={onMintTest} className={secondaryButton} disabled={isSubmitting || !token?.address}>
              💰 Mint 500k test cUSD
            </button>
          </div>
        </div>

        <div className={sectionClass}>
          <h3 className={titleClass}>Finalisation</h3>
          <p className="text-sm text-gray-700 mb-3">
            After the deadline: <strong>1)</strong> anyone calls <code>scheduleFinalization</code>; <strong>2)</strong>{" "}
            wait 12 blocks for finality (defeats reorg-disclosure attack); <strong>3)</strong> anyone calls{" "}
            <code>requestFinalization</code> — relayer decrypts the encrypted total off-chain and posts it via callback.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <button onClick={onSchedule} className={primaryButton} disabled={!buy?.address || isFinalized}>
              ⏱ 1. Schedule reveal
            </button>
            <button onClick={onFinalize} className={primaryButton} disabled={!buy?.address || isFinalized}>
              ⚡ 2. Request finalisation
            </button>
          </div>
        </div>

        {message && (
          <div className={sectionClass}>
            <h3 className={titleClass}>💬 Status</h3>
            <p className="text-sm text-gray-800">{message}</p>
          </div>
        )}

        <div className="text-center text-sm text-gray-500">
          <Link href="/" className="underline hover:text-gray-700">
            ← back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
