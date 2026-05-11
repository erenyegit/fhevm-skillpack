#!/usr/bin/env bash
# DEPRECATED — the FHECounter demo this script bootstrapped has been removed.
# The current demo (ConfidentialGroupBuy) is deployed via `forge create`
# directly. See the "Demo flow" section in submission/community-post.md.
#
# To restore a localhost flow, either:
#   1. forge create both MockCToken + ConfidentialGroupBuy against anvil
#      (FHEVM cleartext host required — see forge-fhevm docs), or
#   2. Write a new DeployDemo.s.sol script that deploys both contracts
#      together, then point this script at it.
echo "scripts/chain.sh is deprecated. See submission/community-post.md and"
echo "the README for the current Sepolia deploy + frontend run flow."
echo ""
echo "Quick smoke test:"
echo "  pnpm contracts:test    # forge test -vv"
echo "  pnpm lint:fhe          # 24-rule AST linter"
echo "  pnpm start             # next dev → http://localhost:3000/group-buy"
exit 0
