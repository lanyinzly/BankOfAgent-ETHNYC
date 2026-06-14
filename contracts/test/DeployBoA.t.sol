// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC7527Agency, ERC7527App, ERC7527Factory} from "../src/ERC7527.sol";
import {IERC7527Agency, Asset} from "../src/interfaces/IERC7527Agency.sol";
import {IERC7527Factory, AgencySettings, AppSettings} from "../src/interfaces/IERC7527Factory.sol";
import {IERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/IERC721Enumerable.sol";

/// @notice Locks in the FOAMM behaviour the BoA relay depends on: deterministic
///         curve, wrap mints a voucher, the premium rises +1% of base per sale,
///         voucher transfers, and unwrap burns + refunds (premium - burnFee).
contract DeployBoATest is Test {
    ERC7527Factory factory;
    address agency; // market agency clone
    address app; // market app clone (the ERC721 voucher)

    // Mirror DeployBoA's demo-friendly params.
    uint256 constant BASE_PREMIUM = 0.00002 ether;
    uint16 constant MINT_FEE = 100; // 1%
    uint16 constant BURN_FEE = 100; // 1%

    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address feeRecipient = address(0xFEE);

    function setUp() public {
        ERC7527Agency agencyImpl = new ERC7527Agency();
        ERC7527App appImpl = new ERC7527App();
        factory = new ERC7527Factory();

        Asset memory asset = Asset({
            currency: address(0),
            basePremium: BASE_PREMIUM,
            feeRecipient: feeRecipient,
            mintFeePercent: MINT_FEE,
            burnFeePercent: BURN_FEE
        });
        AgencySettings memory ag = AgencySettings({
            implementation: payable(address(agencyImpl)),
            asset: asset,
            immutableData: bytes(""),
            initData: bytes("")
        });
        AppSettings memory ap =
            AppSettings({implementation: address(appImpl), immutableData: bytes(""), initData: bytes("")});
        (app, agency) = factory.deployWrap(ag, ap, bytes(""));
    }

    function _premium(uint256 sold) internal pure returns (uint256) {
        return BASE_PREMIUM + sold * BASE_PREMIUM / 100;
    }

    function test_curve_matches_formula() public view {
        (uint256 p0, uint256 f0) = IERC7527Agency(payable(agency)).getWrapOracle(abi.encode(uint256(0)));
        (uint256 p1,) = IERC7527Agency(payable(agency)).getWrapOracle(abi.encode(uint256(1)));
        assertEq(p0, _premium(0), "premium@0");
        assertEq(p1, _premium(1), "premium@1");
        assertEq(f0, p0 * MINT_FEE / 10000, "mintFee@0");
        assertGt(p1, p0, "curve must rise");
    }

    function test_wrap_mints_voucher_and_moves_curve() public {
        vm.deal(alice, 1 ether);

        (uint256 premium0, uint256 fee0) = IERC7527Agency(payable(agency)).getWrapOracle(abi.encode(uint256(0)));
        vm.prank(alice);
        uint256 tokenId =
            IERC7527Agency(payable(agency)).wrap{value: premium0 + fee0}(alice, abi.encode(uint256(1)));

        assertEq(IERC721Enumerable(app).ownerOf(tokenId), alice);
        assertEq(IERC721Enumerable(app).totalSupply(), 1);

        // curve advanced: next wrap is more expensive
        (uint256 premium1,) = IERC7527Agency(payable(agency)).getWrapOracle(abi.encode(uint256(1)));
        assertGt(premium1, premium0, "price must rise after a sale");
    }

    function test_transfer_then_unwrap_refunds_new_owner() public {
        vm.deal(alice, 1 ether);
        (uint256 premium0, uint256 fee0) = IERC7527Agency(payable(agency)).getWrapOracle(abi.encode(uint256(0)));
        vm.prank(alice);
        uint256 tokenId =
            IERC7527Agency(payable(agency)).wrap{value: premium0 + fee0}(alice, abi.encode(uint256(7)));

        // alice transfers the voucher to bob
        vm.prank(alice);
        IERC721Enumerable(app).transferFrom(alice, bob, tokenId);
        assertEq(IERC721Enumerable(app).ownerOf(tokenId), bob);

        // bob unwraps: voucher burned, bob receives premium - burnFee.
        // NOTE: unwrap prices off the POST-burn supply, so with one voucher
        // outstanding the refund is computed at sold == 0.
        (uint256 unwrapPremium, uint256 burnFee) =
            IERC7527Agency(payable(agency)).getUnwrapOracle(abi.encode(uint256(0)));
        uint256 bobBefore = bob.balance;
        vm.prank(bob);
        IERC7527Agency(payable(agency)).unwrap(bob, tokenId, bytes(""));

        assertEq(IERC721Enumerable(app).totalSupply(), 0, "voucher burned");
        assertEq(bob.balance - bobBefore, unwrapPremium - burnFee, "refund to redeemer");
    }
}
