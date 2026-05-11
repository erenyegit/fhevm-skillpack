"use client";

import Link from "next/link";
import { useAccount } from "wagmi";
import { RainbowKitCustomConnectButton } from "~~/components/helper/RainbowKitCustomConnectButton";

const card = "bg-[#f4f4f4] shadow-lg p-8 mb-6 text-gray-900";

export default function Home() {
  const { isConnected } = useAccount();
  return (
    <div className="flex flex-col gap-8 items-center w-full px-3 md:px-0">
      <div className="max-w-3xl mx-auto p-6">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-3 text-black">fhevm-skillpack</h1>
          <p className="text-gray-700">
            Production-grade Skill + 24-rule AST linter + MCP server for AI coding agents on Zama FHEVM.
          </p>
          <p className="text-gray-500 text-sm mt-1">Zama Bounty Track — Season 2</p>
        </div>

        <div className={card}>
          <h2 className="font-bold text-2xl mb-3">🎯 Featured demo — Confidential Group Buy</h2>
          <p className="text-gray-700 mb-4">
            A Kickstarter-style crowdfunding contract where backers pledge encrypted amounts in a confidential ERC-7984
            token. Individual pledges remain private forever; only the total is revealed (and only after the deadline +
            a 12-block finality delay). Demonstrates the full FHEVM lifecycle: external encrypted inputs, ACL on every
            storage write, silent- failure-safe transfers, async decryption with delete-before-effects, and
            post-schedule mutation guards (AP-018, AP-019, AP-010, AP-023, AP-024).
          </p>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <Link
              href="/group-buy"
              className="inline-flex items-center justify-center px-6 py-3 bg-[#FFD208] text-[#2D2D2D] font-semibold shadow-lg hover:bg-[#A38025] transition-colors"
            >
              Open /group-buy →
            </Link>
            {!isConnected && <RainbowKitCustomConnectButton />}
          </div>
        </div>

        <div className={card}>
          <h2 className="font-bold text-lg mb-3">What&apos;s in this repo</h2>
          <ul className="text-sm space-y-1 text-gray-700 list-disc list-inside">
            <li>
              <code>SKILL.md</code> + 10 reference docs — Anthropic-spec progressive disclosure
            </li>
            <li>
              <code>tools/fhe-lint.mjs</code> — 24-rule AST-aware linter (self-test 24/24, bool-vs-ebool aware,
              storage-vs-local aware)
            </li>
            <li>
              <code>tools/fhe-doctor.mjs</code> — auto-fix for AP-001/002/004/005/007
            </li>
            <li>
              <code>mcp-server/</code> — MCP stdio server with 4 tools
            </li>
            <li>
              <code>eval-suite/</code> — 14 prompts × 5 agents matrix
            </li>
            <li>
              <code>packages/foundry/src/ConfidentialGroupBuy.sol</code> — the demo contract, live on Sepolia
            </li>
          </ul>
          <p className="text-xs text-gray-500 mt-4">
            GitHub:{" "}
            <a
              className="underline"
              href="https://github.com/erenyegit/fhevm-skillpack"
              target="_blank"
              rel="noreferrer"
            >
              github.com/erenyegit/fhevm-skillpack
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
