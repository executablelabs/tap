import { afterEach, expect, test } from "bun:test";
import {
  createPublicClient,
  custom,
  encodeAbiParameters,
  encodeEventTopics,
  type Hex,
  type PublicClient,
  toHex,
} from "viem";
import { entryPoint06Abi } from "viem/account-abstraction";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { tapPayAbi } from "../../src/config/abi";
import { DEFAULT_TOKEN, getPaymentChain, PILOT_ACCOUNT_STACK } from "../../src/config/chains";
import { configureTap } from "../../src/config/clients";
import { encodePilotPayment } from "../../src/payment/pilot-calls";
import {
  assertPilotOperation,
  type PilotLimits,
  type PilotOperation,
  parsePilotOperation,
  pilotOperationHash,
  pilotOperationWire,
  signPilotOperation,
  verifyPilotOperationOwner,
} from "../../src/payment/pilot-operation";
import { type PilotReceipt, reconcilePilotReceipt } from "../../src/payment/pilot-receipt";
import { createFakeCore, fakeMerchantAccount } from "../../src/testing";
import { getPilotAccount } from "../../src/wallet/pilot-account";
import {
  type PilotChallenge,
  pilotProofMessage,
  verifyPilotProof,
} from "../../src/wallet/pilot-proof";

const payer = "0x0000000000000000000000000000000000001234";
const paymaster = "0x0000000000000000000000000000000000005678" as const;
const limits: PilotLimits = {
  operationWei: 100_000_000n,
  ownerDailyWei: 200_000_000n,
  globalDailyWei: 500_000_000n,
  principalUsdc: 10_000_000n,
  callGas: 100_000n,
  verificationGas: 100_000n,
  preVerificationGas: 100_000n,
  feePerGas: 100n,
};
afterEach(() => configureTap());
async function fixture() {
  const owner = privateKeyToAccount(generatePrivateKey());
  configureTap({
    paymentClient: createPublicClient({
      chain: baseSepolia,
      transport: custom({
        async request({ method }) {
          if (method !== "eth_call") throw new Error("Unexpected RPC");
          return encodeAbiParameters([{ type: "address" }], [payer]);
        },
      }),
    }) as PublicClient,
  });
  const account = await getPilotAccount(owner.address);
  const core = createFakeCore();
  const signed = await core.signRequest(
    core.newChargeRequest({
      merchant: fakeMerchantAccount.address,
      merchantName: "stall.tap.eth",
      amount: 5_000_000n,
    }),
    fakeMerchantAccount,
  );
  const op: PilotOperation = {
    sender: payer,
    nonce: 0n,
    initCode: account.initCode,
    callData: encodePilotPayment(signed),
    callGasLimit: 50_000n,
    verificationGasLimit: 50_000n,
    preVerificationGas: 20_000n,
    maxFeePerGas: 10n,
    maxPriorityFeePerGas: 1n,
    paymasterAndData: paymaster,
    signature: "0x",
  };
  return { owner, account, signed, op, context: { deployed: false, paymaster } };
}

test("canonical integer wire format and owner signatures use the pinned EP 0.6 hash", async () => {
  const f = await fixture();
  expect(parsePilotOperation(pilotOperationWire(f.op))).toEqual(f.op);
  f.op.signature = await signPilotOperation(f.owner, f.account, f.op, f.signed, limits, f.context);
  expect(await verifyPilotOperationOwner(f.owner.address, f.op)).toBe(true);
  expect(await verifyPilotOperationOwner(f.owner.address, { ...f.op, nonce: 1n })).toBe(false);
  expect(await verifyPilotOperationOwner(fakeMerchantAccount.address, f.op)).toBe(false);
  expect(() =>
    parsePilotOperation({ ...pilotOperationWire(f.op), authorizationList: [] }),
  ).toThrow();
  for (const nonce of ["01", "-1", "1e2", 1, "9".repeat(79)])
    expect(() => parsePilotOperation({ ...pilotOperationWire(f.op), nonce })).toThrow();
});

test("operation rejects every unapproved account, deployment, nonce, paymaster and fee boundary", async () => {
  const f = await fixture();
  for (const change of [
    { sender: fakeMerchantAccount.address },
    { initCode: "0x" },
    { nonce: 1n << 64n },
    { paymasterAndData: f.owner.address },
    { callGasLimit: 0n },
    { maxFeePerGas: limits.feePerGas + 1n },
    { maxPriorityFeePerGas: 11n },
    { verificationGasLimit: limits.verificationGas + 1n },
  ])
    expect(() =>
      assertPilotOperation(
        { ...f.op, ...change } as PilotOperation,
        f.account,
        f.signed,
        limits,
        f.context,
      ),
    ).toThrow();
  expect(() =>
    assertPilotOperation(f.op, f.account, f.signed, { ...limits, operationWei: 1n }, f.context),
  ).toThrow();
  expect(() =>
    assertPilotOperation(f.op, f.account, f.signed, { ...limits, globalDailyWei: 0n }, f.context),
  ).toThrow();
  for (const field of Object.keys(limits)) {
    const incomplete: Record<string, unknown> = { ...limits };
    delete incomplete[field];
    expect(() =>
      assertPilotOperation(f.op, f.account, f.signed, incomplete as PilotLimits, f.context),
    ).toThrow("configured");
  }
  expect(() =>
    assertPilotOperation(
      { ...f.op, authorizationList: [] } as PilotOperation,
      f.account,
      f.signed,
      limits,
      f.context,
    ),
  ).toThrow("fields");
  configureTap({ now: () => new Date(Number(f.signed.request.expiry + 1n) * 1000) });
  expect(() => assertPilotOperation(f.op, f.account, f.signed, limits, f.context)).toThrow(
    "expired",
  );
});

test("intent proofs cannot authorize a different action, audience, request or payer", async () => {
  const f = await fixture();
  const challenge: PilotChallenge = {
    id: "one-use-id",
    audience: "https://tap-pay.xyz",
    owner: f.owner.address,
    payer,
    requestHash: toHex(new Uint8Array(32).fill(1)),
    callDataHash: toHex(new Uint8Array(32).fill(2)),
    expiresAt: Date.now() + 60_000,
  };
  const signature = await f.owner.signMessage({ message: pilotProofMessage(challenge, "prepare") });
  expect(await verifyPilotProof(challenge, "prepare", signature)).toBe(true);
  expect(await verifyPilotProof(challenge, "submit", signature)).toBe(false);
  expect(
    await verifyPilotProof(
      { ...challenge, audience: "https://evil.example" },
      "prepare",
      signature,
    ),
  ).toBe(false);
  expect(
    await verifyPilotProof({ ...challenge, payer: f.owner.address }, "prepare", signature),
  ).toBe(false);
});

test("bundle status alone or another operation's Paid log never credits this customer", async () => {
  const f = await fixture();
  const tx = toHex(new Uint8Array(32).fill(3));
  const chain = getPaymentChain(84532);
  if (!chain) throw new Error("Missing payment chain");
  const paidLog = {
    address: chain.tapPay,
    topics: encodeEventTopics({
      abi: tapPayAbi,
      eventName: "Paid",
      args: { merchant: f.signed.request.merchant, nonce: f.signed.request.nonce, payer },
    }) as [Hex, ...Hex[]],
    data: encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }],
      [DEFAULT_TOKEN, f.signed.request.amount],
    ),
  };
  const userOpLog = (hash = pilotOperationHash(f.op), success = true) => ({
    address: PILOT_ACCOUNT_STACK.entryPoint,
    topics: encodeEventTopics({
      abi: entryPoint06Abi,
      eventName: "UserOperationEvent",
      args: { userOpHash: hash, sender: payer, paymaster },
    }) as [Hex, ...Hex[]],
    data: encodeAbiParameters(
      [{ type: "uint256" }, { type: "bool" }, { type: "uint256" }, { type: "uint256" }],
      [f.op.nonce, success, 1n, 1n],
    ),
  });
  const receipt = (logs: PilotReceipt["logs"]): PilotReceipt => ({
    status: "success",
    transactionHash: tx,
    logs,
  });
  expect(reconcilePilotReceipt(f.op, f.signed, receipt([paidLog, userOpLog()]))).toBe("paid");
  expect(reconcilePilotReceipt(f.op, f.signed, receipt([userOpLog()]))).toBe("unknown");
  expect(
    reconcilePilotReceipt(f.op, f.signed, receipt([paidLog, userOpLog(tx), userOpLog()])),
  ).toBe("unknown");
  expect(reconcilePilotReceipt(f.op, f.signed, receipt([userOpLog(undefined, false)]))).toBe(
    "reverted",
  );
});
