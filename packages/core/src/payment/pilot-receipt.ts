import { type Address, decodeEventLog, type Hash, type Hex, isAddressEqual } from "viem";
import { entryPoint06Abi } from "viem/account-abstraction";
import { tapPayAbi } from "../config/abi";
import { getPaymentChain, PILOT_ACCOUNT_STACK } from "../config/chains";
import { getPaymentClient } from "../config/clients";
import type { SignedRequest } from "../types";
import type { PilotOperation } from "./pilot-operation";
import { pilotOperationHash } from "./pilot-operation";

export type PilotReceipt = {
  status: "success" | "reverted";
  transactionHash: Hash;
  logs: readonly { address: Address; topics: readonly [Hex, ...Hex[]]; data: Hex }[];
};

export async function getPilotReceipt(hash: Hash): Promise<PilotReceipt> {
  const receipt = await getPaymentClient().getTransactionReceipt({ hash });
  const logs: PilotReceipt["logs"][number][] = [];
  for (const log of receipt.logs) {
    const [first, ...rest] = log.topics;
    if (first) logs.push({ address: log.address, data: log.data, topics: [first, ...rest] });
  }
  return { status: receipt.status, transactionHash: receipt.transactionHash, logs };
}

// Only a receipt read from the canonical chain client may enter this boundary.
export function reconcilePilotReceipt(
  op: PilotOperation,
  signed: SignedRequest,
  receipt: PilotReceipt,
): "paid" | "reverted" | "unknown" {
  if (receipt.status !== "success") return "unknown";
  let paidInCurrentOperation = false;
  const tap = getPaymentChain(signed.chainId)?.tapPay;
  for (const log of receipt.logs) {
    const topics: [Hex, ...Hex[]] = [...log.topics];
    try {
      if (tap && isAddressEqual(log.address, tap)) {
        const event = decodeEventLog({ abi: tapPayAbi, eventName: "Paid", data: log.data, topics });
        const args = event.args;
        if (
          isAddressEqual(args.merchant, signed.request.merchant) &&
          args.nonce === signed.request.nonce &&
          isAddressEqual(args.payer, op.sender) &&
          isAddressEqual(args.token, signed.request.token) &&
          args.amount === signed.request.amount
        )
          paidInCurrentOperation = true;
      }
      if (isAddressEqual(log.address, PILOT_ACCOUNT_STACK.entryPoint)) {
        const event = decodeEventLog({
          abi: entryPoint06Abi,
          eventName: "UserOperationEvent",
          data: log.data,
          topics,
        });
        if (
          event.args.userOpHash === pilotOperationHash(op) &&
          isAddressEqual(event.args.sender, op.sender) &&
          event.args.nonce === op.nonce &&
          isAddressEqual(event.args.paymaster, op.paymasterAndData.slice(0, 42) as Address)
        ) {
          return !event.args.success ? "reverted" : paidInCurrentOperation ? "paid" : "unknown";
        }
        paidInCurrentOperation = false;
      }
    } catch {
      /* Unrelated logs are not evidence of payment. */
    }
  }
  return "unknown";
}
