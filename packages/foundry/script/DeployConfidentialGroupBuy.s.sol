// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Script, console} from "forge-std/Script.sol";
import {ConfidentialGroupBuy, IConfidentialToken} from "../src/ConfidentialGroupBuy.sol";

/// @notice Deploys ConfidentialGroupBuy bound to a pre-deployed cUSD token.
/// @dev Set TOKEN_ADDRESS, GOAL_AMOUNT, DEADLINE_OFFSET_DAYS via env.
contract DeployConfidentialGroupBuy is Script {
    function run() external {
        address tokenAddr = vm.envOr("TOKEN_ADDRESS", address(0));
        require(tokenAddr != address(0), "TOKEN_ADDRESS unset");
        uint64  goal      = uint64(vm.envOr("GOAL_AMOUNT", uint256(1_000_000)));
        uint256 days_     = vm.envOr("DEADLINE_OFFSET_DAYS", uint256(14));

        vm.startBroadcast();
        ConfidentialGroupBuy buy = new ConfidentialGroupBuy(
            IConfidentialToken(tokenAddr),
            goal,
            block.timestamp + days_ * 1 days
        );
        vm.stopBroadcast();

        console.log("ConfidentialGroupBuy deployed at:", address(buy));
        console.log("  token:", tokenAddr);
        console.log("  goal :", goal);
        console.log("  deadline (sec):", block.timestamp + days_ * 1 days);
    }
}
