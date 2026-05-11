#!/usr/bin/env node
/**
 * Generates lint-fixtures/AP-XXX/{good.sol,bad.sol} for each rule.
 * Run: node tools/_gen-fixtures.mjs
 *
 * Each pair is a minimal-ish example: bad.sol triggers exactly its rule;
 * good.sol is the corrected version that does not.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const F = join(ROOT, "tools", "lint-fixtures");

const HEADER = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64, externalEuint64, ebool, eaddress, externalEaddress, externalEuint8, euint8, euint32, euint128, euint256} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
`;

const wrap = (body) => `${HEADER}contract Fixture is ZamaEthereumConfig {
${body}
}
`;

const FIX = {
  "AP-001": {
    bad: wrap(`    euint64 public _max;
    function f(euint64 a, euint64 b) external {
        if (FHE.gt(a, b)) { _max = a; } else { _max = b; }
        FHE.allowThis(_max);
    }`),
    good: wrap(`    euint64 public _max;
    function f(euint64 a, euint64 b) external {
        _max = FHE.select(FHE.gt(a, b), a, b);
        FHE.allowThis(_max);
    }`),
  },

  "AP-002": {
    // we deliberately use the legacy import path to trigger the rule
    bad: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;
import "fhevm/lib/TFHE.sol";
contract Fixture {
    function f() external pure {
        TFHE.add(1, 2);
    }
}
`,
    good: wrap(`    function f() external pure {}`),
  },

  "AP-003": {
    bad: wrap(`    euint64 private _v;
    function reveal() external view returns (uint64) {
        return uint64(_v.decrypt());
    }`),
    good: wrap(`    euint64 private _v;
    function reveal() external {
        FHE.makePubliclyDecryptable(_v);
    }`),
  },

  "AP-004": {
    bad: wrap(`    euint64 private _balance;
    function deposit(externalEuint64 enc, bytes calldata proof) external {
        euint64 amount = FHE.fromExternal(enc, proof);
        _balance = FHE.add(_balance, amount);
        // missing FHE.allowThis(_balance) in the next 6 lines
        emit Stuff();
        emit Stuff2();
    }
    event Stuff();
    event Stuff2();`),
    good: wrap(`    euint64 private _balance;
    function deposit(externalEuint64 enc, bytes calldata proof) external {
        euint64 amount = FHE.fromExternal(enc, proof);
        _balance = FHE.add(_balance, amount);
        FHE.allowThis(_balance);
        FHE.allow(_balance, msg.sender);
    }`),
  },

  "AP-005": {
    bad: wrap(`    function bad(euint64 h) external pure returns (uint64) {
        return uint64(euint64.unwrap(h));
    }`),
    good: wrap(`    function good(euint64 h) external pure returns (bytes32) {
        return euint64.unwrap(h);
    }`),
  },

  "AP-006": {
    bad: wrap(`    euint64 private _bal;
    function deposit(externalEuint64 enc, bytes calldata proof) external {
        // no FHE.fromExternal call referencing 'enc'
        _bal = _bal;
        proof;
    }`),
    good: wrap(`    euint64 private _bal;
    function deposit(externalEuint64 enc, bytes calldata proof) external {
        euint64 amount = FHE.fromExternal(enc, proof);
        _bal = FHE.add(_bal, amount);
        FHE.allowThis(_bal);
    }`),
  },

  "AP-007": {
    bad: wrap(`    mapping(address => euint256) private _balances;`),
    good: wrap(`    mapping(address => euint64) private _balances;`),
  },

  "AP-008": {
    bad: wrap(`    function bad(euint64 a, externalEuint64 enc, bytes calldata proof) external {
        euint64 b = FHE.fromExternal(enc, proof);
        FHE.div(a, b);
    }`),
    good: wrap(`    function good(euint64 a) external pure {
        FHE.div(a, 100);
    }`),
  },

  "AP-009": {
    bad: wrap(`    function bad(euint64 a, euint64 b) external pure returns (euint64) {
        return FHE.mul(a, b);
    }`),
    good: wrap(`    uint64 constant MAX = type(uint64).max / 10000;
    function good(euint64 a) external pure returns (euint64) {
        ebool tooBig = FHE.gt(a, FHE.asEuint64(MAX));
        euint64 capped = FHE.select(tooBig, FHE.asEuint64(MAX), a);
        return FHE.mul(capped, FHE.asEuint64(10000));
    }`),
  },

  "AP-010": {
    bad: wrap(`    mapping(uint256 => address) _pending;
    function fulfillWithdraw(uint256 requestId, uint64 amount, bytes[] calldata sigs) external {
        FHE.checkSignatures(amount, sigs);
        address to = _pending[requestId];
        (bool ok,) = to.call{value: amount}("");
        ok;
    }`),
    good: wrap(`    mapping(uint256 => address) _pending;
    function fulfillWithdraw(uint256 requestId, uint64 amount, bytes[] calldata sigs) external {
        address to = _pending[requestId];
        require(to != address(0), "?");
        delete _pending[requestId];
        FHE.checkSignatures(amount, sigs);
        (bool ok,) = to.call{value: amount}("");
        ok;
    }`),
  },

  "AP-011": {
    bad: wrap(`    euint64 private _v;
    function balanceOf() external view returns (euint64) { return _v; }`),
    good: wrap(`    euint64 private _v;
    function grantBalanceAccess() external { FHE.allow(_v, msg.sender); }`),
  },

  "AP-012": {
    bad: wrap(`    address feeHandler;
    function f(euint64 amount) external {
        FHE.allow(amount, address(feeHandler));
    }`),
    good: wrap(`    address feeHandler;
    function f(euint64 amount) external {
        FHE.allowTransient(amount, address(feeHandler));
    }`),
  },

  "AP-013": {
    bad: wrap(`    mapping(bytes32 => bool) used;
    function f(externalEuint64 enc, bytes calldata proof) external {
        bytes32 k = keccak256(abi.encode(enc, proof));
        require(!used[k], "replay");
        used[k] = true;
    }`),
    good: wrap(`    mapping(address => uint256) nonces;
    function f(externalEuint64 enc, bytes calldata proof, uint256 nonce) external {
        require(nonce > nonces[msg.sender], "stale");
        nonces[msg.sender] = nonce;
        euint64 a = FHE.fromExternal(enc, proof);
        a;
    }`),
  },

  "AP-014": {
    bad: `// fixture: frontend
import { createInstance } from "@zama-fhe/sdk";
export function MyComponent() {
    const instance = createInstance({});
    return instance;
}
`,
    good: `// fixture: frontend
import { useEncrypt } from "@zama-fhe/react-sdk";
export function MyComponent() {
    const encrypt = useEncrypt();
    return encrypt;
}
`,
    isFrontend: true,
  },

  "AP-015": {
    bad: `// fixture: frontend
export function persistSig(sig: string) {
    localStorage.setItem("zama-fhe-sig", sig);
}
`,
    good: `// fixture: frontend
const cache = new Map<string, string>();
export function rememberSig(sig: string) { cache.set("k", sig); }
`,
    isFrontend: true,
  },

  "AP-016": {
    bad: `// fixture: frontend
import { useRouter } from "next/navigation";
export function Show(decryptedAmount: bigint) {
    const router = useRouter();
    router.push(\`/result?cleartext=\${decryptedAmount}\`);
}
`,
    good: `// fixture: frontend
import { useState } from "react";
export function Show(decryptedAmount: bigint) {
    const [v] = useState(decryptedAmount);
    return v;
}
`,
    isFrontend: true,
  },

  "AP-017": {
    bad: wrap(`    mapping(bytes32 => address) _pendingDecrypt;
    function bad(euint64 h) external {
        _pendingDecrypt[euint64.unwrap(h)] = msg.sender;
    }`),
    good: wrap(`    mapping(uint256 => address) _pendingDecrypt;
    uint256 _nextId;
    function good(euint64 h) external {
        uint256 id = ++_nextId;
        _pendingDecrypt[id] = msg.sender;
        h;
    }`),
  },

  "AP-018": {
    bad: wrap(`    interface IT { function confidentialTransferFrom(address,address,externalEuint64,bytes calldata) external returns (euint64); }
    address tokenAddr;
    euint64 _highestBid;
    function bid(externalEuint64 enc, bytes calldata proof) external {
        IT(tokenAddr).confidentialTransferFrom(msg.sender, address(this), enc, proof);
        euint64 a = FHE.fromExternal(enc, proof);
        ebool isHigher = FHE.gt(a, _highestBid);
        _highestBid = FHE.select(isHigher, a, _highestBid);
        FHE.allowThis(_highestBid);
    }`).replace(
      "interface IT",
      "}\ninterface IT",
    ).replace("contract Fixture is ZamaEthereumConfig {\n}", "contract Fixture is ZamaEthereumConfig {"),
    good: wrap(`    interface IT2 { function confidentialTransferFrom(address,address,externalEuint64,bytes calldata) external returns (euint64); }
    address tokenAddr;
    euint64 _highestBid;
    function bid(externalEuint64 enc, bytes calldata proof) external {
        euint64 effective = IT2(tokenAddr).confidentialTransferFrom(msg.sender, address(this), enc, proof);
        ebool actuallyTransferred = FHE.gt(effective, FHE.asEuint64(0));
        ebool isHigher = FHE.gt(effective, _highestBid);
        ebool isBest   = FHE.and(actuallyTransferred, isHigher);
        _highestBid = FHE.select(isBest, effective, _highestBid);
        FHE.allowThis(_highestBid);
    }`).replace(
      "interface IT2",
      "}\ninterface IT2",
    ).replace("contract Fixture is ZamaEthereumConfig {\n}", "contract Fixture is ZamaEthereumConfig {"),
  },

  "AP-019": {
    bad: wrap(`    uint256 public constant END = 1000;
    euint64 _bid;
    function reveal() external {
        require(block.timestamp > END);
        FHE.makePubliclyDecryptable(_bid);
    }`),
    good: wrap(`    uint256 public constant END = 1000;
    uint256 _scheduled;
    uint256 constant FINALITY = 12;
    euint64 _bid;
    function scheduleReveal() external { require(block.timestamp > END); _scheduled = block.number; }
    function reveal() external {
        require(block.number >= _scheduled + FINALITY, "wait");
        FHE.makePubliclyDecryptable(_bid);
    }`),
  },

  "AP-020": {
    bad: wrap(`    function validateUserOp(bytes calldata op) external {
        euint64 dummy;
        FHE.allowTransient(dummy, address(this));
        op;
    }`),
    good: wrap(`    function validateUserOp(bytes calldata op) external {
        euint64 dummy;
        FHE.allowTransient(dummy, address(this));
        FHE.cleanTransientStorage();
        op;
    }`),
  },

  "AP-021": {
    bad: wrap(`    mapping(address => euint64) _balances;
    function deposit(externalEuint64 enc, bytes calldata proof) external {
        euint64 a = FHE.fromExternal(enc, proof);
        _balances[msg.sender] = FHE.add(_balances[msg.sender], a);
        FHE.allowThis(_balances[msg.sender]);
    }`),
    good: wrap(`    mapping(address => euint64) _balances;
    function deposit(externalEuint64 enc, externalEaddress encSender, bytes calldata proof) external {
        euint64 a = FHE.fromExternal(enc, proof);
        eaddress claimed = FHE.fromExternal(encSender, proof);
        ebool ok = FHE.eq(claimed, FHE.asEaddress(msg.sender));
        _balances[msg.sender] = FHE.select(ok,
            FHE.add(_balances[msg.sender], a),
            _balances[msg.sender]
        );
        FHE.allowThis(_balances[msg.sender]);
    }`),
  },

  "AP-024": {
    bad: wrap(`    euint64 private _total;
    uint256 public scheduledRevealBlock;
    function pledge(externalEuint64 enc, bytes calldata proof) external {
        euint64 a = FHE.fromExternal(enc, proof);
        _total = FHE.add(_total, a);
        FHE.allowThis(_total);
    }
    function scheduleReveal() external { scheduledRevealBlock = block.number; }
    function reveal() external {
        require(block.number >= scheduledRevealBlock + 12);
        FHE.makePubliclyDecryptable(_total);
    }`),
    good: wrap(`    euint64 private _total;
    uint256 public scheduledRevealBlock;
    function pledge(externalEuint64 enc, bytes calldata proof) external {
        require(scheduledRevealBlock == 0, "scheduled");
        euint64 a = FHE.fromExternal(enc, proof);
        _total = FHE.add(_total, a);
        FHE.allowThis(_total);
    }
    function scheduleReveal() external { scheduledRevealBlock = block.number; }
    function reveal() external {
        require(block.number >= scheduledRevealBlock + 12);
        FHE.makePubliclyDecryptable(_total);
    }`),
  },

  "AP-023": {
    bad: wrap(`    euint64 private _total;
    function reveal() external {
        FHE.makePubliclyDecryptable(_total);
    }`),
    good: wrap(`    euint64 private _total;
    constructor() {
        _total = FHE.asEuint64(0);
        FHE.allowThis(_total);
    }
    function add(externalEuint64 enc, bytes calldata proof) external {
        euint64 amt = FHE.fromExternal(enc, proof);
        _total = FHE.add(_total, amt);
        FHE.allowThis(_total);
    }
    function reveal() external {
        require(FHE.isInitialized(_total), "no ct");
        FHE.makePubliclyDecryptable(_total);
    }`),
  },

  "AP-022": {
    bad: wrap(`    function execute(address target, bytes calldata data) external {
        (bool ok,) = target.call(data);
        ok;
    }`),
    good: wrap(`    mapping(address => bool) whitelist;
    function executeWhitelisted(address target, bytes calldata data) external {
        require(whitelist[target], "denied");
        (bool ok,) = target.call(data);
        ok;
    }`),
  },
};

let count = 0;
for (const [id, pair] of Object.entries(FIX)) {
  const dir = join(F, id);
  mkdirSync(dir, { recursive: true });
  const ext = pair.isFrontend ? "tsx" : "sol";
  writeFileSync(join(dir, `bad.${ext}`), pair.bad);
  writeFileSync(join(dir, `good.${ext}`), pair.good);
  count++;
}
console.log(`Generated fixtures for ${count} rules under ${F}`);
