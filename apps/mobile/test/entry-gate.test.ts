import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { redirectSystemPath } from "../app/+native-intent";
import { copy } from "../src/copy";

const saved = new Map<string, string>();
const destinations: string[] = [];
const router = { push: (path: string) => destinations.push(path) };
let walletLocked = true;
let failWrite = false;
mock.module("expo-secure-store", () => ({
  async getItemAsync(key: string) {
    if (key === "tap.wallet.v1" && walletLocked) throw new Error("locked");
    return saved.get(key) ?? null;
  },
  async setItemAsync(key: string, value: string) {
    if (failWrite) throw new Error("storage unavailable");
    saved.set(key, value);
  },
}));
mock.module("react-native", () => ({
  Platform: { OS: "android", select: (values: { android: string }) => values.android },
  View: "View",
  Text: "Text",
  ScrollView: "ScrollView",
  Pressable: "Pressable",
  ActivityIndicator: "ActivityIndicator",
  StyleSheet: { create: (styles: unknown) => styles },
}));
mock.module("expo-router", () => ({ useRouter: () => router, Link: "Link" }));
mock.module("../src/components/BalanceRow", () => ({ BalanceRow: () => null }));
Object.assign(globalThis, { __DEV__: true, IS_REACT_ACT_ENVIRONMENT: true });
const { EntryGate } = await import("../src/components/EntryGate");
const { Button } = await import("../src/components/Button");
const { WalletProvider } = await import("../src/wallet/WalletProvider");
const { default: HomeScreen } = await import("../app/index");
const { preferencesStore, updateSettings, useSettings } = await import("../src/settings-store");

beforeEach(async () => {
  saved.clear();
  destinations.length = 0;
  walletLocked = true;
  failWrite = false;
  Object.assign(globalThis, { __DEV__: true });
  await preferencesStore.hydrate();
});

afterAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
});

test("a cold payment link survives wallet recovery and failed onboarding persistence", async () => {
  const original = "https://tap-pay.xyz/p?v=1&c=untrusted%2Bpayload";
  const route = redirectSystemPath({ path: original, initial: true });
  const received: string[] = [];
  function PaymentRoute() {
    useEffect(() => {
      received.push(route);
    }, []);
    return createElement("payment-route");
  }
  let renderer: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      createElement(
        WalletProvider,
        null,
        createElement(EntryGate, null, createElement(PaymentRoute)),
      ),
    );
    await preferencesStore.hydrate();
  });
  const text = () => JSON.stringify(renderer.toJSON());
  const press = async (label: string) => {
    await act(async () => {
      renderer.root
        .findAllByType(Button)
        .find((button) => button.props.label === label)
        ?.props.onPress();
    });
  };
  expect(text()).toContain(copy.entry.walletError);
  expect(received).toEqual([]);
  walletLocked = false;
  await press(copy.entry.retry);
  expect(text()).toContain(copy.entry.welcome);
  failWrite = true;
  await press(copy.entry.continue);
  expect(text()).toContain(copy.entry.saveError);
  expect(received).toEqual([]);
  failWrite = false;
  await press(copy.entry.continue);
  expect(received).toEqual([`/customer/confirm?url=${encodeURIComponent(original)}`]);
  // Routine settings persistence must not unmount an active verification/payment route.
  failWrite = true;
  await act(async () => {
    updateSettings({ transport: "qr" });
    await preferencesStore.retrySave();
  });
  expect(text()).toContain(copy.entry.saveError);
  expect(received).toHaveLength(1);
  failWrite = false;
  await act(async () => preferencesStore.retrySave());
  expect(received).toHaveLength(1);
  await act(async () => renderer.unmount());
  await act(async () => preferencesStore.hydrate());
  expect(preferencesStore.getSnapshot().onboardingSaved).toBe(true);
});

test("home waits for explicit customer or merchant navigation", async () => {
  walletLocked = false;
  let renderer: ReactTestRenderer;
  await act(async () => {
    renderer = create(createElement(WalletProvider, null, createElement(HomeScreen)));
  });
  expect(destinations).toEqual([]);
  expect(JSON.stringify(renderer.toJSON())).toContain(copy.entry.testnet);
  await act(async () => {
    renderer.root
      .findAllByType(Button)
      .find((button) => button.props.label === copy.entry.scan)
      ?.props.onPress();
  });
  await act(async () => {
    renderer.root
      .findAllByType(Button)
      .find((button) => button.props.label === copy.entry.merchant)
      ?.props.onPress();
  });
  expect(destinations).toEqual(["/customer", "/merchant"]);
  await act(async () => renderer.unmount());
});

test("release settings cannot activate development verification or tampering", async () => {
  Object.assign(globalThis, { __DEV__: false });
  let actualFake = true;
  let actualTamper: string | null = "a";
  function ObserveSettings() {
    const [settings] = useSettings();
    actualFake = settings.fakeChain;
    actualTamper = settings.demoTamper;
    return null;
  }
  let renderer: ReactTestRenderer;
  await act(async () => {
    renderer = create(createElement(ObserveSettings));
  });
  await act(async () => {
    updateSettings({ fakeChain: true, demoTamper: "a" });
    await preferencesStore.retrySave();
  });
  expect(actualFake).toBe(false);
  expect(actualTamper).toBeNull();
  // Development fields are never part of persisted preferences.
  expect(saved.get("tap.preferences.v1")).not.toContain("fakeChain");
  expect(saved.get("tap.preferences.v1")).not.toContain("demoTamper");
  await act(async () => renderer.unmount());
  Object.assign(globalThis, { __DEV__: true });
});
