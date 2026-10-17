import type { LocalAccount } from "viem";
import {
  type Address,
  decodeAbiParameters,
  encodeAbiParameters,
  type Hash,
  type Hex,
  isAddress,
  isAddressEqual,
  isHex,
  recoverAddress,
  size,
} from "viem";
import { getUserOperationHash } from "viem/account-abstraction";
import { PILOT_ACCOUNT_STACK } from "../config/chains";
import type { SignedRequest } from "../types";
import { getPilotAccount, type PilotAccount, pilotAccountAdapter } from "../wallet/pilot-account";
import { validateSettlement } from "./pay";
import { assertPilotPayment } from "./pilot-calls";

export type PilotOperation = {
  sender: Address;
  nonce: bigint;
  initCode: Hex;
  callData: Hex;
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  paymasterAndData: Hex;
  signature: Hex;
};
export type PilotLimits = {
  operationWei: bigint;
  ownerDailyWei: bigint;
  globalDailyWei: bigint;
  principalUsdc: bigint;
  callGas: bigint;
  verificationGas: bigint;
  preVerificationGas: bigint;
  feePerGas: bigint;
};
export type PilotStatus =
  | "created"
  | "preparing"
  | "prepared"
  | "submitting"
  | "pending"
  | "unknown"
  | "paid"
  | "reverted";
export type PilotOperationWire = { [K in keyof PilotOperation]: string };
const integerFields = [
  "nonce",
  "callGasLimit",
  "verificationGasLimit",
  "preVerificationGas",
  "maxFeePerGas",
  "maxPriorityFeePerGas",
] as const;
const bytesFields = ["initCode", "callData", "paymasterAndData", "signature"] as const;
const wrapper = [
  {
    type: "tuple",
    components: [
      { name: "ownerIndex", type: "uint8" },
      { name: "signatureData", type: "bytes" },
    ],
  },
] as const;

export function pilotOperationWire(op: PilotOperation): PilotOperationWire {
  return {
    ...op,
    nonce: op.nonce.toString(),
    callGasLimit: op.callGasLimit.toString(),
    verificationGasLimit: op.verificationGasLimit.toString(),
    preVerificationGas: op.preVerificationGas.toString(),
    maxFeePerGas: op.maxFeePerGas.toString(),
    maxPriorityFeePerGas: op.maxPriorityFeePerGas.toString(),
  };
}

export function parsePilotOperation(value: unknown): PilotOperation {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid pilot operation");
  const data = value as Record<string, unknown>;
  if (Object.keys(data).length !== 11 || typeof data.sender !== "string" || !isAddress(data.sender))
    throw new Error("Invalid pilot operation fields");
  for (const field of integerFields) {
    const n = data[field];
    if (typeof n !== "string" || !/^(0|[1-9][0-9]{0,77})$/.test(n) || BigInt(n) >= 1n << 256n)
      throw new Error("Invalid pilot integer");
  }
  for (const field of bytesFields) {
    const bytes = data[field];
    if (
      typeof bytes !== "string" ||
      !isHex(bytes) ||
      bytes.length % 2 !== 0 ||
      bytes.length > 131_074
    )
      throw new Error("Invalid pilot bytes");
  }
  const wire = data as PilotOperationWire;
  return {
    ...wire,
    sender: wire.sender as Address,
    initCode: wire.initCode as Hex,
    callData: wire.callData as Hex,
    paymasterAndData: wire.paymasterAndData as Hex,
    signature: wire.signature as Hex,
    nonce: BigInt(wire.nonce),
    callGasLimit: BigInt(wire.callGasLimit),
    verificationGasLimit: BigInt(wire.verificationGasLimit),
    preVerificationGas: BigInt(wire.preVerificationGas),
    maxFeePerGas: BigInt(wire.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(wire.maxPriorityFeePerGas),
  };
}

export function pilotOperationHash(op: PilotOperation): Hash {
  return getUserOperationHash({
    chainId: PILOT_ACCOUNT_STACK.chainId,
    entryPointAddress: PILOT_ACCOUNT_STACK.entryPoint,
    entryPointVersion: "0.6",
    userOperation: op,
  });
}

export function assertPilotOperation(
  op: PilotOperation,
  account: PilotAccount,
  signed: SignedRequest,
  limits: PilotLimits,
  context: { deployed: boolean; paymaster: Address },
): void {
  validateSettlement(signed);
  if (Object.values(limits).some((n) => typeof n !== "bigint" || n <= 0n))
    throw new Error("Pilot budgets are not configured");
  if (
    account.chainId !== PILOT_ACCOUNT_STACK.chainId ||
    account.version !== PILOT_ACCOUNT_STACK.version ||
    !isAddressEqual(op.sender, account.payer) ||
    op.nonce < 0n ||
    op.nonce >= 1n << 64n
  )
    throw new Error("Unexpected pilot account or nonce channel");
  if (op.initCode.toLowerCase() !== (context.deployed ? "0x" : account.initCode.toLowerCase()))
    throw new Error("Unexpected pilot deployment");
  assertPilotPayment(signed, op.callData);
  if (
    signed.request.amount > limits.principalUsdc ||
    size(op.paymasterAndData) < 20 ||
    !isAddressEqual(op.paymasterAndData.slice(0, 42) as Address, context.paymaster)
  )
    throw new Error("Unexpected pilot principal or paymaster");
  if (
    op.callGasLimit <= 0n ||
    op.callGasLimit > limits.callGas ||
    op.verificationGasLimit <= 0n ||
    op.verificationGasLimit > limits.verificationGas ||
    op.preVerificationGas <= 0n ||
    op.preVerificationGas > limits.preVerificationGas ||
    op.maxFeePerGas <= 0n ||
    op.maxFeePerGas > limits.feePerGas ||
    op.maxPriorityFeePerGas < 0n ||
    op.maxPriorityFeePerGas > op.maxFeePerGas
  )
    throw new Error("Pilot gas bounds exceeded");
  // EntryPoint 0.6 charges up to THREE verification gas limits for a paymaster.
  if (
    (op.callGasLimit + 3n * op.verificationGasLimit + op.preVerificationGas) * op.maxFeePerGas >
    limits.operationWei
  )
    throw new Error("Pilot reservation exceeded");
}

export async function signPilotOperation(
  owner: LocalAccount,
  account: PilotAccount,
  op: PilotOperation,
  signed: SignedRequest,
  limits: PilotLimits,
  context: { deployed: boolean; paymaster: Address },
): Promise<Hex> {
  assertPilotOperation(op, account, signed, limits, context);
  const derived = await pilotAccountAdapter(owner);
  const canonical = await getPilotAccount(owner.address);
  if (
    canonical.initCode.toLowerCase() !== account.initCode.toLowerCase() ||
    !isAddressEqual(owner.address, account.owner) ||
    !isAddressEqual(derived.address, account.payer) ||
    !isAddressEqual(op.sender, derived.address)
  )
    throw new Error("Pilot owner/account mismatch");
  return derived.signUserOperation({ ...op, chainId: PILOT_ACCOUNT_STACK.chainId });
}

export async function verifyPilotOperationOwner(
  owner: Address,
  op: PilotOperation,
): Promise<boolean> {
  try {
    const [signature] = decodeAbiParameters(wrapper, op.signature);
    if (
      signature.ownerIndex !== 0 ||
      size(signature.signatureData) !== 65 ||
      encodeAbiParameters(wrapper, [signature]).toLowerCase() !== op.signature.toLowerCase()
    )
      return false;
    return isAddressEqual(
      await recoverAddress({ hash: pilotOperationHash(op), signature: signature.signatureData }),
      owner,
    );
  } catch {
    return false;
  }
}
