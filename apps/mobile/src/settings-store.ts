import type { TamperField } from "@tap/core/testing";
import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";
import { createPreferencesStore, defaultPreferences, type Preferences } from "./preferences";

export type AppSettings = Preferences & {
  demoTamper: TamperField | null;
  fakeChain: boolean;
};

export const defaultSettings: AppSettings = {
  ...defaultPreferences,
  demoTamper: null,
  fakeChain: false,
};

let state: AppSettings = defaultSettings;
const listeners = new Set<() => void>();
export const preferencesStore = createPreferencesStore(SecureStore);
preferencesStore.subscribe(() => {
  state = { ...state, ...preferencesStore.getSnapshot().preferences };
  for (const listener of listeners) listener();
});

function getSnapshot(): AppSettings {
  return state;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function updateSettings(patch: Partial<AppSettings>): void {
  // Test helpers are session-only and cannot be enabled in a release build.
  state = { ...state, ...patch, ...(__DEV__ ? {} : { fakeChain: false, demoTamper: null }) };
  for (const listener of listeners) listener();
  const { onboardingComplete, merchantName, transport } = state;
  void preferencesStore.update({ onboardingComplete, merchantName, transport });
}

export function usePreferencesStatus() {
  return useSyncExternalStore(preferencesStore.subscribe, preferencesStore.getSnapshot);
}

export function useSettings(): [AppSettings, typeof updateSettings] {
  return [useSyncExternalStore(subscribe, getSnapshot), updateSettings];
}
