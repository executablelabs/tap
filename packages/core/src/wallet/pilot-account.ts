import {
  type Address,
  concatHex,
  encodeFunctionData,
  type Hex,
  type LocalAccount,
  pad,
} from "viem";
import { toCoinbaseSmartAccount } from "viem/account-abstraction";
import { PILOT_ACCOUNT_STACK } from "../config/chains";
import { getPaymentClient } from "../config/clients";

export type PilotAccount = {
  owner: Address;
  payer: Address;
  initCode: Hex;
  chainId: typeof PILOT_ACCOUNT_STACK.chainId;
  version: typeof PILOT_ACCOUNT_STACK.version;
};

export async function pilotAccountAdapter(owner: Address | LocalAccount) {
  return toCoinbaseSmartAccount({
    client: getPaymentClient(),
    owners: [owner],
    version: PILOT_ACCOUNT_STACK.version,
    nonce: 0n,
  });
}

// Read-only derivation. Never deploys, moves funds, or replaces the owner's EOA.
export async function getPilotAccount(owner: Address): Promise<PilotAccount> {
  const account = await pilotAccountAdapter(owner);
  if (account.factory.address.toLowerCase() !== PILOT_ACCOUNT_STACK.factory.toLowerCase())
    throw new Error("Unexpected pilot factory");
  // Keep canonical deployment data even for already deployed accounts; the provider
  // chooses empty initCode only after independently checking deployed account state.
  const factoryData = encodeFunctionData({
    abi: account.factory.abi,
    functionName: "createAccount",
    args: [[pad(owner)], 0n],
  });
  return {
    owner,
    payer: account.address,
    initCode: concatHex([account.factory.address, factoryData]),
    chainId: PILOT_ACCOUNT_STACK.chainId,
    version: PILOT_ACCOUNT_STACK.version,
  };
}
