# BoA Contracts — ERC-7527 FOAMM membership market

The on-chain half of the Bank of Agent spine: the **ERC-7527 FOAMM** stack
(`ERC7527Agency` / `ERC7527App` / `ERC7527Factory`) plus a deploy script that
spins up **one BoA membership market** on Base Sepolia with demo-friendly pricing.

The three contracts are **vendored byte-for-byte** from the sibling repo
[`lanyinzly/EIP7527`](https://github.com/lanyinzly/EIP7527) (only an SPDX header
added) so this directory builds and deploys self-contained.

## Live deployment

A BoA membership market is deployed and verified live on **Ethereum Sepolia
(chainId 11155111)** — recorded in [`deployments.json`](./deployments.json) and
read by the relay in `onchain` mode.

| contract | address |
| --- | --- |
| Factory | [`0x7f22C05da2F4C9063477dA14101D2c56D510785E`](https://sepolia.etherscan.io/address/0x7f22C05da2F4C9063477dA14101D2c56D510785E) |
| Agency impl | [`0x65c57Ebc829D64da70bb067d68250Eeee21C297E`](https://sepolia.etherscan.io/address/0x65c57Ebc829D64da70bb067d68250Eeee21C297E) |
| App impl | [`0xD71B89C4b00D80763e47D3d4dEac649e936e3F5c`](https://sepolia.etherscan.io/address/0xD71B89C4b00D80763e47D3d4dEac649e936e3F5c) |
| **Market — Agency** (wrap/unwrap) | [`0x47d5b439FdC1Bb59ee1A6Ae7bfDED8e246ee33EE`](https://sepolia.etherscan.io/address/0x47d5b439FdC1Bb59ee1A6Ae7bfDED8e246ee33EE) |
| **Market — App** (ERC-721 voucher) | [`0xc72e56656266dA245276336DCA0c861F0A2739B4`](https://sepolia.etherscan.io/address/0xc72e56656266dA245276336DCA0c861F0A2739B4) |

The FOAMM was exercised on-chain (curve moves on buy, refund on redeem):

- `wrap`   → [`0x5ec10baf456105258687c10a04006d792cd6a50a8a8e6c0d853a943bec472931`](https://sepolia.etherscan.io/tx/0x5ec10baf456105258687c10a04006d792cd6a50a8a8e6c0d853a943bec472931)
- `unwrap` → [`0x5b3d27aec7ffaf638559bdf17c8db986a20bd0d763531996ff256bc8e15cfec0`](https://sepolia.etherscan.io/tx/0x5b3d27aec7ffaf638559bdf17c8db986a20bd0d763531996ff256bc8e15cfec0)

> The deploy script and relay are **chain-agnostic** — Base Sepolia (the design
> target, chainId 84532) is supported identically via `make deploy-base`; the live
> deployment above used Ethereum Sepolia for funding convenience.

## FOAMM curve

```
premium = basePremium + sold * basePremium / 100      # +1% of base per sale
mintFee = premium * mintFeePercent / 10000
burnFee = premium * burnFeePercent / 10000
```

- `wrap()`  = buy membership (mint voucher); premium rises along the curve.
- `unwrap()` = redeem/exit (burn voucher); refunds `premium - burnFee`, **priced at
  the post-burn supply**.
- The voucher is the `ERC7527App` ERC-721 (transferable).

### Demo market parameters (`script/DeployBoA.s.sol`)

| param | value | note |
| --- | --- | --- |
| `currency` | `address(0)` | native ETH |
| `basePremium` | `0.00002 ether` | tiny, so a full demo costs a sliver of testnet ETH |
| `mintFeePercent` | `100` | 1.00% of premium |
| `burnFeePercent` | `100` | 1.00% of premium |
| `maxSupply` | `100` | from `ERC7527App` |

## Reproduce

### 0. Toolchain

```bash
curl -L https://foundry.paradigm.xyz | bash && foundryup    # forge + anvil + cast
make deps                                                   # installs lib/ deps
```

`make deps` clones `forge-std`, `openzeppelin-contracts@v5.0.2`, and
`clones-with-immutable-args` into `lib/` (git-ignored).

### 1. Build + test

```bash
make build
make test        # locks in the curve, wrap/transfer/unwrap behaviour
```

### 2a. Deploy to a local chain (no funds needed)

```bash
anvil &                       # in another shell
make deploy-local             # uses anvil account #0
cat deployments.json
```

### 2b. Deploy to Base Sepolia

```bash
export PRIVATE_KEY=0x...                 # a FUNDED Base Sepolia key
export BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
# optional, for source verification:
export ETHERSCAN_API_KEY=...             # BaseScan API key
make deploy-base
```

Get testnet ETH from a Base Sepolia faucet (e.g. the Coinbase Developer Platform
or Alchemy faucet) before deploying. The script writes the resulting addresses to
[`deployments.json`](./deployments.json), which the relay reads in `onchain` mode.

Equivalent raw command:

```bash
forge script script/DeployBoA.s.sol:DeployBoA \
  --rpc-url base_sepolia --private-key $PRIVATE_KEY --broadcast --verify
```

### 2c. Deploy to Ethereum Sepolia

Same script, different chain (this is what the live deployment above uses):

```bash
export PRIVATE_KEY=0x...      # a FUNDED Ethereum Sepolia key
make deploy-sepolia           # ETH_SEPOLIA_RPC_URL defaults to a public node
```

## `deployments.json`

Written by the deploy script and consumed by the relay (`CHAIN_MODE=onchain`):

```jsonc
{
  "chainId": 84532,
  "deployer": "0x…",
  "factory": "0x…",
  "agencyImpl": "0x…",
  "appImpl": "0x…",
  "market": {
    "id": "boa-membership",
    "agency": "0x…",   // the market's Agency clone (wrap/unwrap live here)
    "app": "0x…",      // the ERC-721 voucher
    "currency": "0x0000000000000000000000000000000000000000",
    "feeRecipient": "0x…",
    "basePremium": 20000000000000,
    "mintFeePercent": 100,
    "burnFeePercent": 100
  }
}
```

> The committed `deployments.json` records the **most recent deploy**. Its `chainId`
> field tells you which network it targets (`11155111` = Ethereum Sepolia — current,
> `84532` = Base Sepolia, `31337` = local anvil). Re-run `make deploy-sepolia` /
> `make deploy-base` to refresh it.

## Layout

```
contracts/
  foundry.toml
  remappings.txt
  src/
    ERC7527.sol               vendored Agency + App + Factory
    interfaces/               vendored ERC-7527 interfaces
  script/DeployBoA.s.sol      deploys the stack + one membership market, writes deployments.json
  test/DeployBoA.t.sol        curve + wrap/transfer/unwrap behaviour tests
  deployments.json            deployed addresses (consumed by the relay)
```
