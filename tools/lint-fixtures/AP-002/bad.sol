// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;
import "fhevm/lib/TFHE.sol";
contract Fixture {
    function f() external pure {
        TFHE.add(1, 2);
    }
}
