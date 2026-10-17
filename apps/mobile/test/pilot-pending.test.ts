import { expect, test } from "bun:test";
import { createPreferencesStore } from "../src/preferences";
import { hasUnresolvedPilot } from "../src/sponsorship/pending";

test.each(["{", '{"status":"unknown"}', '{"status":"paid"}', "false"])(
  "unresolved, corrupt or unverified terminal records block fallback: %s",
  async (raw) => {
    expect(
      await hasUnresolvedPilot(
        { getItemAsync: async () => raw, setItemAsync: async () => {} },
        "owner",
      ),
    ).toBe(true);
  },
);
test("only missing or explicitly dismissed journals permit a new payment", async () => {
  for (const raw of [null, "null"])
    expect(
      await hasUnresolvedPilot(
        { getItemAsync: async () => raw, setItemAsync: async () => {} },
        "owner",
      ),
    ).toBe(false);
  expect(
    await hasUnresolvedPilot(
      {
        getItemAsync: async () => {
          throw new Error("locked");
        },
        setItemAsync: async () => {},
      },
      "owner",
    ),
  ).toBe(true);
});
test("pilot opt-in binds owner, separate payer, chain and account version; old/invalid selections are off", async () => {
  const consent = {
    owner: "0x0000000000000000000000000000000000000001",
    payer: "0x0000000000000000000000000000000000000002",
    version: "1.1" as const,
    chainId: 84532 as const,
  };
  let raw: string | null = null;
  const storage = {
    getItemAsync: async () => raw,
    setItemAsync: async (_key: string, next: string) => {
      raw = next;
    },
  };
  const store = createPreferencesStore(storage);
  await store.hydrate();
  expect(store.getSnapshot().preferences.pilotConsent).toBeNull();
  await store.update({ pilotConsent: consent });
  const relaunched = createPreferencesStore(storage);
  await relaunched.hydrate();
  expect(relaunched.getSnapshot().preferences.pilotConsent).toEqual(consent);
  raw = JSON.stringify({ version: 1, pilotConsent: { ...consent, version: "other" } });
  await relaunched.hydrate();
  expect(relaunched.getSnapshot().preferences.pilotConsent).toBeNull();
});
