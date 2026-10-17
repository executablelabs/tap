import { expect, test } from "bun:test";
import { createReadSession } from "../src/read-session";

function fixture() {
  let reads = 0;
  let cancels = 0;
  let resolve: (url: string) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const urls: string[] = [];
  const errors: unknown[] = [];
  const reading: boolean[] = [];
  const session = createReadSession({
    read: () => {
      reads++;
      return new Promise<string>((yes, no) => {
        resolve = yes;
        reject = no;
      });
    },
    cancel: async () => {
      cancels++;
    },
    onUrl: (url) => urls.push(url),
    onError: (error) => errors.push(error),
    onReading: (value) => reading.push(value),
  });
  return {
    session,
    urls,
    errors,
    reading,
    resolve: (url: string) => resolve(url),
    reject: () => reject(new Error("timeout")),
    reads: () => reads,
    cancels: () => cancels,
  };
}

test("launch and focus never read; an explicit start reads once and preserves the untrusted URL", async () => {
  const f = fixture();
  f.session.activate();
  expect(f.reads()).toBe(0);
  const pending = f.session.start();
  await f.session.start();
  expect(f.reads()).toBe(1);
  const url = "https://tap-pay.xyz/p?v=1&c=untrusted%2Bpayload";
  f.resolve(url);
  await pending;
  expect(f.urls).toEqual([url]);
  expect(f.reading).toEqual([true, false]);
});

test.each(["cancel", "deactivate"] as const)(
  "%s prevents stale reads from navigating after QR/blur",
  async (action) => {
    const f = fixture();
    f.session.activate();
    const pending = f.session.start();
    f.session[action]();
    f.session.activate();
    f.resolve("late result");
    await pending;
    expect(f.urls).toEqual([]);
    expect(f.cancels()).toBe(1);
  },
);

test("read errors recover only on an explicit retry", async () => {
  const f = fixture();
  f.session.activate();
  const pending = f.session.start();
  f.reject();
  await pending;
  expect(f.errors).toHaveLength(1);
  expect(f.reads()).toBe(1);
  const retry = f.session.start();
  f.resolve("next request");
  await retry;
  expect(f.urls).toEqual(["next request"]);
});

test("a rapid cancel/retry waits for native cleanup before starting another read", async () => {
  const f = fixture();
  f.session.activate();
  const first = f.session.start();
  f.session.cancel();
  const retry = f.session.start();
  expect(f.reads()).toBe(1);
  f.resolve("cancelled result");
  await first;
  await Promise.resolve();
  expect(f.reads()).toBe(2);
  f.resolve("new result");
  await retry;
  expect(f.urls).toEqual(["new result"]);
});
