// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {ERC7527Agency, ERC7527App, ERC7527Factory} from "../src/ERC7527.sol";
import {IERC7527Agency, Asset} from "../src/interfaces/IERC7527Agency.sol";
import {IERC7527Factory, AgencySettings, AppSettings} from "../src/interfaces/IERC7527Factory.sol";

/// @title DeployBoA
/// @notice Deploys the ERC-7527 FOAMM stack (Agency + App + Factory implementations)
///         and spins up ONE Bank-of-Agent membership market via `deployWrap`, using
///         demo-friendly parameters. After broadcasting it writes the resulting
///         addresses to `contracts/deployments.json` so the relay can read them.
///
/// FOAMM curve (from ERC7527Agency):
///   premium = basePremium + sold * basePremium / 100      (i.e. +1% of base per sale)
///   mintFee = premium * mintFeePercent / 10000
///   burnFee = premium * burnFeePercent / 10000
///
/// Run (local anvil):
///   forge script script/DeployBoA.s.sol:DeployBoA --rpc-url http://127.0.0.1:8545 \
///     --private-key <key> --broadcast
///
/// Run (Base Sepolia):
///   forge script script/DeployBoA.s.sol:DeployBoA --rpc-url base_sepolia \
///     --private-key $PRIVATE_KEY --broadcast --verify
contract DeployBoA is Script {
    // ---- demo-friendly market parameters -------------------------------------
    // basePremium kept tiny so a full demo costs a sliver of testnet ETH while the
    // +1%/sale curve is still clearly visible in the price oracle.
    uint256 internal constant BASE_PREMIUM = 0.00002 ether; // 20_000 gwei
    uint16 internal constant MINT_FEE_PERCENT = 100; // 1.00%  (of premium)
    uint16 internal constant BURN_FEE_PERCENT = 100; // 1.00%  (of premium)
    string internal constant MARKET_ID = "boa-membership";

    function run() external {
        // The broadcaster is the deployer; fee recipient defaults to it but can be
        // overridden with the FEE_RECIPIENT env var.
        address deployer = msg.sender;
        address feeRecipient = vm.envOr("FEE_RECIPIENT", deployer);

        vm.startBroadcast();

        ERC7527Agency agencyImpl = new ERC7527Agency();
        ERC7527App appImpl = new ERC7527App();
        ERC7527Factory factory = new ERC7527Factory();

        Asset memory asset = Asset({
            currency: address(0), // native ETH
            basePremium: BASE_PREMIUM,
            feeRecipient: feeRecipient,
            mintFeePercent: MINT_FEE_PERCENT,
            burnFeePercent: BURN_FEE_PERCENT
        });

        AgencySettings memory agencySettings = AgencySettings({
            implementation: payable(address(agencyImpl)),
            asset: asset,
            immutableData: bytes(""),
            initData: bytes("")
        });
        AppSettings memory appSettings =
            AppSettings({implementation: address(appImpl), immutableData: bytes(""), initData: bytes("")});

        (address marketApp, address marketAgency) = factory.deployWrap(agencySettings, appSettings, bytes(""));

        vm.stopBroadcast();

        _log(deployer, feeRecipient, address(factory), address(agencyImpl), address(appImpl), marketApp, marketAgency);
        _write(deployer, feeRecipient, address(factory), address(agencyImpl), address(appImpl), marketApp, marketAgency);
    }

    function _log(
        address deployer,
        address feeRecipient,
        address factory,
        address agencyImpl,
        address appImpl,
        address marketApp,
        address marketAgency
    ) internal view {
        console.log("== BoA membership market deployed ==");
        console.log("chainId       ", block.chainid);
        console.log("deployer      ", deployer);
        console.log("feeRecipient  ", feeRecipient);
        console.log("factory       ", factory);
        console.log("agencyImpl    ", agencyImpl);
        console.log("appImpl       ", appImpl);
        console.log("market.app    ", marketApp);
        console.log("market.agency ", marketAgency);
        console.log("basePremium   ", BASE_PREMIUM);
    }

    function _write(
        address deployer,
        address feeRecipient,
        address factory,
        address agencyImpl,
        address appImpl,
        address marketApp,
        address marketAgency
    ) internal {
        string memory market = "market";
        vm.serializeString(market, "id", MARKET_ID);
        vm.serializeAddress(market, "agency", marketAgency);
        vm.serializeAddress(market, "app", marketApp);
        vm.serializeAddress(market, "currency", address(0));
        vm.serializeAddress(market, "feeRecipient", feeRecipient);
        vm.serializeUint(market, "basePremium", BASE_PREMIUM);
        vm.serializeUint(market, "mintFeePercent", MINT_FEE_PERCENT);
        string memory marketJson = vm.serializeUint(market, "burnFeePercent", BURN_FEE_PERCENT);

        string memory root = "root";
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeAddress(root, "deployer", deployer);
        vm.serializeAddress(root, "factory", factory);
        vm.serializeAddress(root, "agencyImpl", agencyImpl);
        vm.serializeAddress(root, "appImpl", appImpl);
        string memory finalJson = vm.serializeString(root, "market", marketJson);

        vm.writeJson(finalJson, "./deployments.json");
        console.log("wrote ./deployments.json");
    }
}
