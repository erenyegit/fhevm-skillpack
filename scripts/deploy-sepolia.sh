#!/usr/bin/env bash
# DEPRECATED — the bounty-track demo is deployed with `forge create` directly
# (see submission/community-post.md for the live verified addresses and the
# inline deployment recipe).
echo "scripts/deploy-sepolia.sh is deprecated."
echo ""
echo "Live deploys:"
echo "  ConfidentialGroupBuy → 0xCB4e3F1Dea12F2e4b380188F429Cccf2e8938423"
echo "  MockCToken (cUSD)    → 0x9Ab7912a600049De984E4C79AfC90E34eE17c08f"
echo ""
echo "Redeploy command (example):"
echo "  forge create src/ConfidentialGroupBuy.sol:ConfidentialGroupBuy \\"
echo "    --rpc-url \$SEPOLIA_RPC_URL --private-key \$DEPLOYER_PRIVATE_KEY \\"
echo "    --broadcast --verify --etherscan-api-key \$ETHERSCAN_API_KEY \\"
echo "    --constructor-args <TOKEN> <GOAL_AMOUNT> <DEADLINE_TS>"
exit 0
