// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {TapPay} from "../src/TapPay.sol";
import {MockERC20Permit} from "./mocks/MockERC20Permit.sol";

/// @dev ABI-compatible revert-all fixture, NOT the deployed Coinbase account or EntryPoint.
contract PilotBatchFixture {
    struct Call { address target; uint256 value; bytes data; }
    address private immutable owner;
    constructor() { owner = msg.sender; }
    function executeBatch(Call[] calldata calls) external {
        require(msg.sender == owner, "owner");
        for (uint256 i; i < calls.length; ++i) {
            (bool ok, bytes memory result) = calls[i].target.call{value: calls[i].value}(calls[i].data);
            if (!ok) assembly { revert(add(result, 32), mload(result)) }
        }
    }
}

/// @notice Proves TapPay caller attribution and EVM rollback for the pilot call template.
contract PilotBatchTest is Test {
    event Paid(address indexed merchant, bytes32 indexed nonce, address indexed payer, address token, uint256 amount);
    TapPay private tap;
    MockERC20Permit private token;
    PilotBatchFixture private account;
    TapPay.PaymentRequest private request;
    bytes private signature;

    function setUp() public {
        tap = new TapPay();
        token = new MockERC20Permit();
        account = new PilotBatchFixture();
        request = TapPay.PaymentRequest(vm.addr(42), address(token), 5_000_000, keccak256("pilot"), uint64(block.timestamp + 120), "stall.tap.eth");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(42, tap.hashRequest(request));
        signature = abi.encodePacked(r, s, v);
        token.mint(address(account), request.amount);
    }

    function _calls() private view returns (PilotBatchFixture.Call[] memory calls) {
        calls = new PilotBatchFixture.Call[](2);
        calls[0] = PilotBatchFixture.Call(address(token), 0, abi.encodeCall(token.approve, (address(tap), request.amount)));
        calls[1] = PilotBatchFixture.Call(address(tap), 0, abi.encodeCall(tap.pay, (request, signature)));
    }

    function test_AccountIsPayerAndAllowanceIsConsumed() public {
        vm.expectEmit(true, true, true, true, address(tap));
        emit Paid(request.merchant, request.nonce, address(account), address(token), request.amount);
        account.executeBatch(_calls());
        assertEq(token.balanceOf(request.merchant), request.amount);
        assertEq(token.allowance(address(account), address(tap)), 0);
    }

    function test_SettlementFailureRollsBackApproval() public {
        request.expiry = uint64(block.timestamp);
        vm.expectRevert(TapPay.Expired.selector);
        account.executeBatch(_calls());
        assertEq(token.allowance(address(account), address(tap)), 0);
        assertEq(token.balanceOf(address(account)), request.amount);
        assertFalse(tap.isPaid(request.merchant, request.nonce));
    }
}
