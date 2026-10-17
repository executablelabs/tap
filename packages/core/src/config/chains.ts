import { type Address, getAddress } from "viem";
import { baseSepolia, sepolia } from "viem/chains";

export const PAYMENT_CHAIN_ID = 84532 as const;
export const ENS_CHAIN_ID = 11155111 as const;
export const ENS_PARENT = "tap.eth";

// Offline pilot candidate from the viem 2.56.9 Coinbase Smart Wallet 1.1 adapter.
// These identities do not enable sponsorship or attest deployed code/provider compatibility.
export const PILOT_ACCOUNT_STACK = {
  chainId: PAYMENT_CHAIN_ID,
  version: "1.1",
  entryPointVersion: "0.6",
  entryPoint: "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789" as Address,
  factory: "0xba5ed110efdba3d005bfc882d75358acbbb85842" as Address,
} as const;

export const paymentChains = {
  [PAYMENT_CHAIN_ID]: {
    chain: baseSepolia,
    tapPay: "0x4c679b2dE8AE517fF12AA34A1bE0F81913678792" as Address,
    swap: {
      adapter: "0xA36df4D6DA08bA1FbE89ddEB7229218FAf0BF84d" as Address,
      router: "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4" as Address,
      quoter: "0xC5290058841028F1614F3A6F0F5816cAd0df5E27" as Address,
      permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address,
      weth: "0x4200000000000000000000000000000000000006" as Address,
      feeTiers: [100, 500, 3_000, 10_000],
    },
    tokens: {
      "0x036CbD53842c5426634e7929541eC2318f3dCF7e": {
        symbol: "USDC",
        decimals: 6,
        display: "usd",
      },
    },
  },
} as const;

export const ensConfig = {
  chain: sepolia,
  parent: ENS_PARENT,
  merchantRegistrar: "0xcF7F9f2f0a9a471B1E2D6c4F0D1a59563821B759" as Address,
} as const;

export const DEFAULT_TOKEN = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address;

export function getPaymentChain(chainId: number) {
  return chainId === PAYMENT_CHAIN_ID ? paymentChains[PAYMENT_CHAIN_ID] : undefined;
}

export function getTokenConfig(chainId: number, token: Address) {
  const chain = getPaymentChain(chainId);
  if (!chain) return undefined;

  try {
    const canonicalToken = getAddress(token);
    const entry = Object.entries(chain.tokens).find(
      ([address]) => getAddress(address) === canonicalToken,
    );
    if (!entry) return undefined;

    return { address: getAddress(entry[0]), ...entry[1] };
  } catch {
    return undefined;
  }
}
