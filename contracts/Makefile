# BoA contracts — convenience targets. Run from contracts/.
# Requires foundry on PATH (forge/anvil/cast): https://getfoundry.sh

OZ_VERSION ?= v5.0.2
LOCAL_RPC  ?= http://127.0.0.1:8545
# well-known public anvil account #0 — local use only
ANVIL_KEY  ?= 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

ETH_SEPOLIA_RPC_URL ?= https://ethereum-sepolia-rpc.publicnode.com

.PHONY: deps build test clean deploy-local deploy-base deploy-sepolia

deps:
	mkdir -p lib
	[ -d lib/forge-std ] || git clone --depth 1 https://github.com/foundry-rs/forge-std lib/forge-std
	[ -d lib/clones-with-immutable-args ] || git clone --depth 1 https://github.com/wighawag/clones-with-immutable-args lib/clones-with-immutable-args
	[ -d lib/openzeppelin-contracts ] || git clone --depth 1 --branch $(OZ_VERSION) https://github.com/OpenZeppelin/openzeppelin-contracts lib/openzeppelin-contracts

build:
	forge build

test:
	forge test -vv

clean:
	forge clean

# Deploy to a local anvil node (no funds needed). Start `anvil` first.
deploy-local:
	forge script script/DeployBoA.s.sol:DeployBoA \
		--rpc-url $(LOCAL_RPC) --private-key $(ANVIL_KEY) --broadcast

# Deploy to Base Sepolia. Requires a FUNDED key:
#   export PRIVATE_KEY=0x... ; export BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
#   (optional) export ETHERSCAN_API_KEY=... for --verify
deploy-base:
	@test -n "$(PRIVATE_KEY)" || { echo "set PRIVATE_KEY (a funded Base Sepolia key)"; exit 1; }
	forge script script/DeployBoA.s.sol:DeployBoA \
		--rpc-url base_sepolia --private-key $(PRIVATE_KEY) --broadcast

# Deploy to Ethereum Sepolia. Requires a FUNDED key:
#   export PRIVATE_KEY=0x...   (ETH_SEPOLIA_RPC_URL defaults to a public node)
deploy-sepolia:
	@test -n "$(PRIVATE_KEY)" || { echo "set PRIVATE_KEY (a funded Ethereum Sepolia key)"; exit 1; }
	forge script script/DeployBoA.s.sol:DeployBoA \
		--rpc-url $(ETH_SEPOLIA_RPC_URL) --private-key $(PRIVATE_KEY) --broadcast
