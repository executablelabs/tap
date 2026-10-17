import { afterEach, expect, test } from "bun:test";
import { encodeFunctionData, type Hex } from "viem";
import { configureTap } from "../../src/config/clients";
import {
  assertPilotPayment,
  encodePilotPayment,
  pilotBatchAbi,
  pilotPaymentCallHash,
  pilotPaymentCalls,
} from "../../src/payment/pilot-calls";
import { createFakeCore, fakeMerchantAccount } from "../../src/testing";

afterEach(() => configureTap());
async function request() {
  const core = createFakeCore();
  return core.signRequest(
    core.newChargeRequest({
      merchant: fakeMerchantAccount.address,
      merchantName: "stall.tap.eth",
      amount: 5_000_000n,
    }),
    fakeMerchantAccount,
  );
}

test("pilot batch is exactly approval + original payment, with zero native value", async () => {
  const signed = await request();
  const encoded = encodePilotPayment(signed);
  expect(() => assertPilotPayment(signed, encoded)).not.toThrow();
  expect(pilotPaymentCalls(signed).map((call) => call.value)).toEqual([0n, 0n]);
  expect(() => assertPilotPayment(signed, `${encoded}00`)).toThrow();
  const digest = pilotPaymentCallHash(signed);
  configureTap({ now: () => new Date(Number(signed.request.expiry + 1n) * 1000) });
  expect(pilotPaymentCallHash(signed)).toBe(digest); // Archive verification survives expiry.
});

test("rejects every altered inner call, extra call and single-call wrapper", async () => {
  const signed = await request();
  const calls = pilotPaymentCalls(signed);
  const encode = (batch: readonly { target: `0x${string}`; value: bigint; data: Hex }[]) =>
    encodeFunctionData({ abi: pilotBatchAbi, functionName: "executeBatch", args: [batch] });
  for (const changed of [
    [...calls, calls[0]],
    [calls[1], calls[0]],
    [{ ...calls[0], value: 1n }, calls[1]],
    [{ ...calls[0], target: fakeMerchantAccount.address }, calls[1]],
    [calls[0], { ...calls[1], data: `${calls[1].data}00` as Hex }],
  ])
    expect(() => assertPilotPayment(signed, encode(changed))).toThrow();
  expect(() => assertPilotPayment(signed, calls[1].data)).toThrow();
  const other = { ...signed, request: { ...signed.request, amount: signed.request.amount + 1n } };
  expect(() => assertPilotPayment(other, encodePilotPayment(signed))).toThrow();
});
