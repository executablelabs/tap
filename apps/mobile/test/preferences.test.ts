import { describe, expect, test } from "bun:test";
import { createPreferencesStore, type SecureStorage } from "../src/preferences";

function fixture(raw: string | null = null) {
  let value = raw;
  let failRead = false;
  let failWrite = false;
  const storage: SecureStorage = {
    async getItemAsync() {
      if (failRead) throw new Error("locked");
      return value;
    },
    async setItemAsync(_key, next) {
      if (failWrite) throw new Error("full");
      value = next;
    },
  };
  return {
    storage,
    store: createPreferencesStore(storage),
    readFails: (fail: boolean) => {
      failRead = fail;
    },
    writeFails: (fail: boolean) => {
      failWrite = fail;
    },
  };
}

describe("device preferences", () => {
  test("first run, ordered changes, and completion survive a new store", async () => {
    const { store, storage } = fixture();
    await store.hydrate();
    expect(store.getSnapshot().preferences.onboardingComplete).toBe(false);
    await Promise.all([
      store.update({ transport: "qr" }),
      store.update({ onboardingComplete: true, merchantName: "stall.tap.eth" }),
    ]);
    const relaunched = createPreferencesStore(storage);
    await relaunched.hydrate();
    expect(relaunched.getSnapshot().preferences).toEqual({
      onboardingComplete: true,
      merchantName: "stall.tap.eth",
      transport: "qr",
      pilotConsent: null,
    });
    expect(await storage.getItemAsync("tap.preferences.v1")).not.toContain("fakeChain");
  });

  test("a failed read cannot become a first run or overwrite existing preferences", async () => {
    const f = fixture('{"version":1,"onboardingComplete":true}');
    f.readFails(true);
    await f.store.hydrate();
    await f.store.update({ onboardingComplete: false });
    expect(f.store.getSnapshot().status).toBe("error");
    f.readFails(false);
    await f.store.hydrate();
    expect(f.store.getSnapshot().preferences.onboardingComplete).toBe(true);
  });

  test("failed completion is visible and retry persists the selected preferences", async () => {
    const f = fixture();
    await f.store.hydrate();
    f.writeFails(true);
    await f.store.update({ onboardingComplete: true, transport: "qr" });
    expect(f.store.getSnapshot().saveError).toBe(true);
    expect(f.store.getSnapshot().onboardingSaved).toBe(false);
    f.writeFails(false);
    await f.store.retrySave();
    expect(f.store.getSnapshot().saveError).toBe(false);
    expect(f.store.getSnapshot().onboardingSaved).toBe(true);
    const relaunched = createPreferencesStore(f.storage);
    await relaunched.hydrate();
    expect(relaunched.getSnapshot().preferences.onboardingComplete).toBe(true);
  });

  test.each(["{", '{"version":2}'])(
    "corrupt/unknown data requires explicit preferences recovery: %s",
    async (raw) => {
      const { store } = fixture(raw);
      await store.hydrate();
      expect(store.getSnapshot().status).toBe("error");
      await store.reset();
      expect(store.getSnapshot().status).toBe("ready");
      expect(store.getSnapshot().preferences.onboardingComplete).toBe(false);
    },
  );

  test("invalid field values never grant completion or enable testing helpers", async () => {
    const { store } = fixture(
      '{"version":1,"onboardingComplete":"true","transport":"bad","fakeChain":true}',
    );
    await store.hydrate();
    expect(store.getSnapshot().preferences).toEqual({
      onboardingComplete: false,
      merchantName: "yoyogi-market.tap.eth",
      transport: "nfc",
      pilotConsent: null,
    });
  });
});
