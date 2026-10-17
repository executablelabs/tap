import type { Address, LocalAccount } from "@tap/core";
import { privateKeyToAccount } from "@tap/core";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { loadOrCreatePrivateKey, resetPrivateKey } from "./secure-key";

type WalletContextValue = {
  account: LocalAccount | null;
  address: Address | null;
  isLoading: boolean;
  error: boolean;
  retryWallet(): Promise<void>;
  resetWallet(): Promise<void>;
};

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<LocalAccount | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);
  const busy = useRef(false);

  const load = useCallback(async (reset = false) => {
    if (busy.current) return;
    busy.current = true;
    setIsLoading(true);
    setError(false);
    try {
      const key = await (reset ? resetPrivateKey() : loadOrCreatePrivateKey());
      setAccount(privateKeyToAccount(key));
    } catch {
      setError(true);
    } finally {
      busy.current = false;
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const value = useMemo<WalletContextValue>(
    () => ({
      account,
      address: account?.address ?? null,
      isLoading,
      error,
      retryWallet: () => load(),
      resetWallet: () => load(true),
    }),
    [account, isLoading, error, load],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const value = useContext(WalletContext);
  if (!value) throw new Error("useWallet must be used inside WalletProvider");
  return value;
}
