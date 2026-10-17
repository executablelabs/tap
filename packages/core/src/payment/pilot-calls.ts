import {
  decodeFunctionData,
  encodeFunctionData,
  type Hash,
  type Hex,
  keccak256,
  parseAbi,
} from "viem";
import { tapPayAbi } from "../config/abi";
import { DEFAULT_TOKEN, getPaymentChain, PAYMENT_CHAIN_ID } from "../config/chains";
import type { SignedRequest } from "../types";

const approvalAbi = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);
export const pilotBatchAbi = parseAbi([
  "function executeBatch((address target, uint256 value, bytes data)[] calls)",
]);

export function pilotPaymentCalls(signed: SignedRequest) {
  const chain = getPaymentChain(signed.chainId);
  if (
    !chain ||
    signed.request.amount <= 0n ||
    signed.chainId !== PAYMENT_CHAIN_ID ||
    signed.request.token.toLowerCase() !== DEFAULT_TOKEN.toLowerCase()
  ) {
    throw new Error("Unsupported pilot payment");
  }
  return [
    {
      target: DEFAULT_TOKEN,
      value: 0n,
      data: encodeFunctionData({
        abi: approvalAbi,
        functionName: "approve",
        args: [chain.tapPay, signed.request.amount],
      }),
    },
    {
      target: chain.tapPay,
      value: 0n,
      data: encodeFunctionData({
        abi: tapPayAbi,
        functionName: "pay",
        args: [signed.request, signed.signature],
      }),
    },
  ] as const;
}

export function encodePilotPayment(signed: SignedRequest): Hex {
  return encodeFunctionData({
    abi: pilotBatchAbi,
    functionName: "executeBatch",
    args: [pilotPaymentCalls(signed)],
  });
}

export function pilotPaymentCallHash(signed: SignedRequest): Hash {
  return keccak256(encodePilotPayment(signed));
}

export function assertPilotPayment(signed: SignedRequest, callData: Hex): void {
  const decoded = decodeFunctionData({ abi: pilotBatchAbi, data: callData });
  const expected = pilotPaymentCalls(signed);
  const calls = decoded.args[0];
  if (calls.length !== expected.length) throw new Error("Unexpected pilot batch length");
  for (const [index, call] of calls.entries()) {
    const allowed = expected[index];
    if (
      !allowed ||
      call.value !== 0n ||
      call.target.toLowerCase() !== allowed.target.toLowerCase() ||
      call.data.toLowerCase() !== allowed.data.toLowerCase()
    ) {
      throw new Error("Unexpected pilot inner call");
    }
  }
  // Reject trailing bytes, alternate offsets and noncanonical/nested wrapper encodings.
  if (callData.toLowerCase() !== encodePilotPayment(signed).toLowerCase())
    throw new Error("Noncanonical pilot batch");
}
