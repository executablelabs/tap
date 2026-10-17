import { afterEach, expect, test } from "bun:test";
import { createPublicClient, custom, encodeAbiParameters, type PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { PILOT_ACCOUNT_STACK } from "../../src/config/chains";
import { configureTap } from "../../src/config/clients";
import { encodePilotPayment, pilotPaymentCalls } from "../../src/payment/pilot-calls";
import { createFakeCore, fakeMerchantAccount } from "../../src/testing";
import { getPilotAccount, pilotAccountAdapter } from "../../src/wallet/pilot-account";

afterEach(() => configureTap());
test("pinned adapter uses EP 0.6, one owner, separate address and identical atomic batch ABI", async () => {
  const fakeCustomerAccount = privateKeyToAccount(generatePrivateKey());
  const payer = "0x0000000000000000000000000000000000001234";
  const methods: string[] = [];
  configureTap({
    paymentClient: createPublicClient({
      chain: baseSepolia,
      transport: custom({
        async request({ method }) {
          methods.push(method);
          if (method !== "eth_call") throw new Error("Unexpected RPC");
          return encodeAbiParameters([{ type: "address" }], [payer]);
        },
      }),
    }) as PublicClient,
  });
  const descriptor = await getPilotAccount(fakeCustomerAccount.address);
  expect(descriptor.payer).toBe(payer);
  expect(descriptor.owner).toBe(fakeCustomerAccount.address);
  expect(descriptor.payer).not.toBe(descriptor.owner);
  expect(descriptor.initCode.slice(0, 42)).toBe(PILOT_ACCOUNT_STACK.factory);
  const account = await pilotAccountAdapter(fakeCustomerAccount);
  expect(account.entryPoint).toMatchObject({
    address: PILOT_ACCOUNT_STACK.entryPoint,
    version: "0.6",
  });
  const core = createFakeCore();
  const signed = await core.signRequest(
    core.newChargeRequest({
      merchant: fakeMerchantAccount.address,
      merchantName: "stall.tap.eth",
      amount: 5_000_000n,
    }),
    fakeMerchantAccount,
  );
  const calls = pilotPaymentCalls(signed).map((call) => ({
    to: call.target,
    value: call.value,
    data: call.data,
  }));
  expect(await account.encodeCalls(calls)).toBe(encodePilotPayment(signed));
  expect(methods.every((method) => method === "eth_call")).toBe(true);
});
