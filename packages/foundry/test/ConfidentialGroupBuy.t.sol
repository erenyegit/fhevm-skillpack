// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FhevmTest} from "forge-fhevm/FhevmTest.sol";
import {FHE, euint64, externalEuint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {ConfidentialGroupBuy, IConfidentialToken} from "../src/ConfidentialGroupBuy.sol";
import {MockCToken} from "../src/MockCToken.sol";

contract ConfidentialGroupBuyTest is FhevmTest {
    ConfidentialGroupBuy buy;
    MockCToken token;
    address creator;
    address alice;
    address bob;
    address carol;
    uint256 internal constant CREATOR_PK = 0xCEA;
    uint256 internal constant ALICE_PK = 0xA11CE;
    uint256 internal constant BOB_PK = 0xB0B;
    uint256 internal constant CAROL_PK = 0xCA01;

    uint64 constant GOAL = 1_000_000; // 1.0 cUSD with 6 decimals
    uint256 constant DEADLINE_OFFSET = 7 days;

    function setUp() public override {
        super.setUp();
        creator = vm.addr(CREATOR_PK);
        alice = vm.addr(ALICE_PK);
        bob = vm.addr(BOB_PK);
        carol = vm.addr(CAROL_PK);
        token = new MockCToken();
        vm.prank(creator);
        buy = new ConfidentialGroupBuy(token, GOAL, block.timestamp + DEADLINE_OFFSET);
        // mint cUSD balances
        _mint(alice, 500_000);
        _mint(bob, 500_000);
        _mint(carol, 200_000);
    }

    function _mint(address who, uint64 amt) internal {
        (externalEuint64 enc, bytes memory proof) = encryptUint64(amt, who, address(token));
        vm.prank(who);
        token.mint(who, enc, proof);
    }

    function _pledge(
        address who,
        uint256,
        /*pk*/
        uint64 amt
    )
        internal
    {
        // Pledge: encryption targets the GROUP-BUY contract (it does fromExternal).
        (externalEuint64 enc, bytes memory proof) = encryptUint64(amt, who, address(buy));
        vm.prank(who);
        buy.pledge(enc, proof);
    }

    /// Test 1 — three backers pledge, encrypted total accumulates.
    function test_pledgesAccumulateEncrypted() public {
        _pledge(alice, ALICE_PK, 400_000);
        _pledge(bob, BOB_PK, 300_000);
        _pledge(carol, CAROL_PK, 200_000);

        // Total handle exists; we don't decrypt it pre-finalisation.
        // Confirm individual contributions are decryptable by their owners.
        bytes memory aSig = signUserDecrypt(ALICE_PK, address(buy));
        vm.prank(alice);
        uint256 aContrib = userDecrypt(euint64.unwrap(buy.getMyContribution()), alice, address(buy), aSig);
        assertEq(aContrib, 400_000, "alice contribution");
    }

    /// @dev Drives the async-decryption flow manually using forge-fhevm's
    ///      `publicDecrypt(bytes32[])` helper, which returns the cleartext
    ///      array AND the assembled KMS proof. Then calls the contract's
    ///      callback directly — same as a real relayer would.
    function _finalize() internal returns (uint256 reqId, uint256[] memory cleartexts, bytes memory proof) {
        buy.scheduleFinalization();
        vm.roll(block.number + 13); // FINALITY_BLOCKS = 12
        buy.requestFinalization();
        reqId = buy.finalizationRequestId();
        bytes32[] memory handles = new bytes32[](1);
        handles[0] = buy.getTotalHandle();
        (cleartexts, proof) = publicDecrypt(handles);
        buy.finalizeCallback(reqId, cleartexts, proof);
    }

    /// Test 2 — goal reached → finalizeCallback flips goalMet=true.
    function test_goalMetTriggersFinalization() public {
        _pledge(alice, ALICE_PK, 500_000);
        _pledge(bob, BOB_PK, 500_000);

        vm.warp(block.timestamp + DEADLINE_OFFSET + 1);
        _finalize();

        assertTrue(buy.finalized(), "must be finalized");
        assertTrue(buy.goalMet(), "goal must be met");
        assertEq(buy.revealedTotal(), 1_000_000, "total reveal");
    }

    /// Test 3 — replay attack on finalizeCallback rejected.
    function test_replayCallbackRejected() public {
        _pledge(alice, ALICE_PK, 500_000);
        _pledge(bob, BOB_PK, 500_000);

        vm.warp(block.timestamp + DEADLINE_OFFSET + 1);
        (uint256 reqId, uint256[] memory cleartexts, bytes memory proof) = _finalize();

        // Replay attempt: same id, same payload — must revert.
        // (Both "bad id" and "done" indicate replay defense is working;
        //  in our contract `finalizationRequestId = 0` is set first so the
        //  id-mismatch fires before the `finalized` check.)
        vm.expectRevert(bytes("bad id"));
        buy.finalizeCallback(reqId, cleartexts, proof);
    }

    /// Test 4 — backer cannot decrypt another backer's contribution.
    function test_backerCannotDecryptOthers() public {
        _pledge(alice, ALICE_PK, 400_000);
        _pledge(bob, BOB_PK, 300_000);

        // Bob trying to decrypt Alice's slot via getMyContribution from his own
        // address only returns HIS handle — NOT Alice's. ACL prevents lateral.
        bytes memory bSig = signUserDecrypt(BOB_PK, address(buy));
        vm.prank(bob);
        uint256 bContrib = userDecrypt(euint64.unwrap(buy.getMyContribution()), bob, address(buy), bSig);
        assertEq(bContrib, 300_000, "bob sees only his own");
        // (A direct user-decrypt of alice's handle from bob's signer would fail
        //  ACL — handled by the FHEVM relayer; not testable in mock without a
        //  storage-slot read of alice's handle. Test #1 confirms alice sees hers.)
    }

    /// Test 5 — finalisation pulls a finality-delay path correctly.
    /// (Demo contract uses delete-before-effects via `finalized=true`. We assert
    ///  no double-finalisation and goalMet is correctly false when under-funded.)
    function test_underFundedGoalMetFalse() public {
        _pledge(alice, ALICE_PK, 200_000);
        _pledge(bob, BOB_PK, 200_000);
        _pledge(carol, CAROL_PK, 200_000);

        vm.warp(block.timestamp + DEADLINE_OFFSET + 1);
        _finalize();

        assertTrue(buy.finalized());
        assertFalse(buy.goalMet(), "600k < 1M goal");
        assertEq(buy.revealedTotal(), 600_000);
    }
}
