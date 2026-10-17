import { expect, test } from "bun:test";
import { createKeyStorage } from "../src/wallet/key-storage";

test("a failed first wallet write never exposes an unpersisted key", async () => {
  const storage = createKeyStorage({
    getItemAsync: async () => null,
    setItemAsync: async () => {
      throw new Error("unavailable");
    },
  });
  await expect(storage.load()).rejects.toThrow();
});

test("a device wallet survives reload and a failed replacement", async () => {
  let value: string | null = null;
  let failWrite = false;
  const storage = createKeyStorage({
    getItemAsync: async () => value,
    async setItemAsync(_key, key) {
      if (failWrite) throw new Error("locked");
      value = key;
    },
  });
  const first = await storage.load();
  expect(await storage.load()).toBe(first);
  failWrite = true;
  await expect(storage.replace()).rejects.toThrow();
  expect(await storage.load()).toBe(first);
  failWrite = false;
  expect(await storage.replace()).not.toBe(first);
});

test("a read failure retries the existing wallet without creating or writing a key", async () => {
  let locked = true;
  const existing = await createKeyStorage({
    getItemAsync: async () => null,
    setItemAsync: async () => {},
  }).load();
  let writes = 0;
  const storage = createKeyStorage({
    async getItemAsync() {
      if (locked) throw new Error("locked");
      return existing;
    },
    async setItemAsync() {
      writes++;
    },
  });
  await expect(storage.load()).rejects.toThrow();
  locked = false;
  expect(await storage.load()).toBe(existing);
  expect(writes).toBe(0);
});

test.each(["", "broken", `0x${"0".repeat(64)}`])(
  "invalid stored keys fail closed without overwriting: %s",
  async (value) => {
    let writes = 0;
    const storage = createKeyStorage({
      getItemAsync: async () => value,
      async setItemAsync() {
        writes++;
      },
    });
    await expect(storage.load()).rejects.toThrow();
    expect(writes).toBe(0);
  },
);
