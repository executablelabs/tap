import { PILOT_ACCOUNT_STACK, type PilotAccount } from "@tap/core";

export type PilotConsent = Pick<PilotAccount, "owner" | "payer" | "version" | "chainId">;

export type Preferences = {
  onboardingComplete: boolean;
  merchantName: string;
  transport: "nfc" | "qr";
  pilotConsent: PilotConsent | null;
};

export const defaultPreferences: Preferences = {
  onboardingComplete: false,
  merchantName: "yoyogi-market.tap.eth",
  transport: "nfc",
  pilotConsent: null,
};

export type SecureStorage = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
};

type Snapshot = {
  preferences: Preferences;
  status: "loading" | "ready" | "error";
  saving: boolean;
  saveError: boolean;
  onboardingSaved: boolean;
};

const PREFERENCES_KEY = "tap.preferences.v1";

function consent(value: unknown): PilotConsent | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (
    typeof data.owner !== "string" ||
    typeof data.payer !== "string" ||
    !/^0x[0-9a-fA-F]{40}$/.test(data.owner) ||
    !/^0x[0-9a-fA-F]{40}$/.test(data.payer) ||
    data.owner.toLowerCase() === data.payer.toLowerCase() ||
    data.version !== PILOT_ACCOUNT_STACK.version ||
    data.chainId !== PILOT_ACCOUNT_STACK.chainId
  )
    return null;
  return data as PilotConsent;
}

function decode(raw: string | null): Preferences {
  if (raw === null) return { ...defaultPreferences };
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1) {
    throw new Error("Unsupported preferences");
  }
  return {
    onboardingComplete: "onboardingComplete" in value && value.onboardingComplete === true,
    merchantName:
      "merchantName" in value && typeof value.merchantName === "string"
        ? value.merchantName
        : defaultPreferences.merchantName,
    transport: "transport" in value && value.transport === "qr" ? "qr" : "nfc",
    pilotConsent: "pilotConsent" in value ? consent(value.pilotConsent) : null,
  };
}

// Native-free persistence boundary: writes stay ordered and failures remain retryable.
export function createPreferencesStore(storage: SecureStorage) {
  let snapshot: Snapshot = {
    preferences: { ...defaultPreferences },
    status: "loading",
    saving: false,
    saveError: false,
    onboardingSaved: false,
  };
  const listeners = new Set<() => void>();
  let loading: Promise<void> | undefined;
  let writes = Promise.resolve();
  let revision = 0;
  function publish(patch: Partial<Snapshot>) {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
  }
  function hydrate(): Promise<void> {
    if (loading) return loading;
    publish({ status: "loading" });
    loading = (async () => {
      try {
        const preferences = decode(await storage.getItemAsync(PREFERENCES_KEY));
        publish({ preferences, onboardingSaved: preferences.onboardingComplete, status: "ready" });
      } catch {
        publish({ status: "error" });
      } finally {
        loading = undefined;
      }
    })();
    return loading;
  }
  function update(patch: Partial<Preferences>): Promise<void> {
    if (snapshot.status !== "ready") return Promise.resolve();
    const preferences = { ...snapshot.preferences, ...patch };
    const current = ++revision;
    publish({ preferences, saving: true, saveError: false });
    writes = writes.then(async () => {
      try {
        await storage.setItemAsync(PREFERENCES_KEY, JSON.stringify({ version: 1, ...preferences }));
        if (current === revision)
          publish({ saving: false, onboardingSaved: preferences.onboardingComplete });
      } catch {
        if (current === revision) publish({ saving: false, saveError: true });
      }
    });
    return writes;
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    hydrate,
    update,
    retrySave: () => update({}),
    async reset() {
      publish({ status: "ready", onboardingSaved: false });
      await update(defaultPreferences);
    },
  };
}
