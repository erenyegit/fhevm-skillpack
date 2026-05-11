// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64, externalEuint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IConfidentialToken} from "./ConfidentialGroupBuy.sol";

/// @title MockCToken — minimal confidential test token for the demo.
/// @notice Demonstrates AP-018 silent-failure semantics: transferred amount
///         is `min(requested, balance)` via `FHE.select`, NOT the requested
///         amount. Used as the cUSD stand-in by ConfidentialGroupBuy.
/// @dev    Differs from full ERC-7984 in that transfers take an
///         already-validated `euint64` handle rather than `(externalEuint64,
///         bytes proof)` — avoids cross-contract proof-binding ambiguity.
contract MockCToken is IConfidentialToken, ZamaEthereumConfig {
    mapping(address => euint64) public balances;

    function mint(address to, externalEuint64 enc, bytes calldata proof) external {
        euint64 amount = FHE.fromExternal(enc, proof);
        balances[to] = FHE.add(balances[to], amount);
        FHE.allowThis(balances[to]);
        FHE.allow(balances[to], to);
    }

    function transferFromValidated(address from, address to, euint64 amount) external returns (euint64 transferred) {
        require(FHE.isSenderAllowed(amount), "no ACL");
        ebool sufficient = FHE.ge(balances[from], amount);
        transferred = FHE.select(sufficient, amount, FHE.asEuint64(0));
        balances[from] = FHE.sub(balances[from], transferred);
        balances[to] = FHE.add(balances[to], transferred);
        FHE.allowThis(balances[from]);
        FHE.allowThis(balances[to]);
        FHE.allow(balances[from], from);
        FHE.allow(balances[to], to);
        FHE.allowTransient(transferred, msg.sender);
    }

    function transferValidated(address to, euint64 amount) external returns (euint64 transferred) {
        require(FHE.isSenderAllowed(amount), "no ACL");
        ebool sufficient = FHE.ge(balances[msg.sender], amount);
        transferred = FHE.select(sufficient, amount, FHE.asEuint64(0));
        balances[msg.sender] = FHE.sub(balances[msg.sender], transferred);
        balances[to] = FHE.add(balances[to], transferred);
        FHE.allowThis(balances[msg.sender]);
        FHE.allowThis(balances[to]);
        FHE.allow(balances[msg.sender], msg.sender);
        FHE.allow(balances[to], to);
        FHE.allowTransient(transferred, msg.sender);
    }
}
