import { generatePrivateKey, type Hex, privateKeyToAccount } from "@tap/core";
import type { SecureStorage } from "../preferences";

const WALLET_KEY = "tap.wallet.v1";

export function createKeyStorage(storage: SecureStorage) {
  async function replace(): Promise<Hex> {
    const key = generatePrivateKey();
    // Overwrite atomically: a failed write must not delete the previous wallet.
    await storage.setItemAsync(WALLET_KEY, key);
    return key;
  }
  return {
    async load(): Promise<Hex> {
      const existing = await storage.getItemAsync(WALLET_KEY);
      if (existing !== null) {
        if (!/^0x[0-9a-fA-F]{64}$/.test(existing)) throw new Error("Invalid stored wallet");
        const key = existing as Hex;
        privateKeyToAccount(key);
        return key;
      }
      return replace();
    },
    replace,
  };
}
