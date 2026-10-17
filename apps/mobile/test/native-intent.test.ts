import { describe, expect, test } from "bun:test";
import { redirectSystemPath } from "../app/+native-intent";

describe("native payment links", () => {
  test.each([true, false])(
    "routes a canonical payment URL to verification without decoding it (initial=%s)",
    (initial) => {
      const url = "https://tap-pay.xyz/p?v=1&c=signed%2Bpayload";

      expect(redirectSystemPath({ path: url, initial })).toBe(
        `/customer/confirm?url=${encodeURIComponent(url)}`,
      );
    },
  );

  test.each([
    "http://tap-pay.xyz/p?v=1",
    "https://tap-pay.xyz.evil.example/p?v=1",
    "https://attacker@tap-pay.xyz/p?v=1",
    "https://tap-pay.xyz/payment?v=1",
    "not a URL",
  ])("fails closed for non-canonical input: %s", (path) => {
    expect(redirectSystemPath({ path, initial: false })).toBe("/");
  });
});
