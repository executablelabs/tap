import { expect, test } from "bun:test";
import { backOrHome, entryStage } from "../src/entry-state";

const ready = {
  preferencesStatus: "ready",
  walletLoading: false,
  walletAvailable: true,
  onboardingSaved: true,
} as const;

test("entry never grants access before wallet hydration and durable onboarding", () => {
  expect(entryStage({ ...ready, preferencesStatus: "loading" })).toBe("loading");
  expect(entryStage({ ...ready, walletLoading: true })).toBe("loading");
  expect(entryStage({ ...ready, walletAvailable: false })).toBe("wallet-error");
  expect(entryStage({ ...ready, preferencesStatus: "error" })).toBe("preferences-error");
  expect(entryStage({ ...ready, onboardingSaved: false })).toBe("onboarding");
  expect(entryStage(ready)).toBe("ready");
});

test("direct settings/merchant entry has a home fallback; ordinary navigation goes back", () => {
  const actions: string[] = [];
  const router = {
    canGoBack: () => false,
    back: () => actions.push("back"),
    replace: (path: "/") => actions.push(path),
  };
  backOrHome(router);
  backOrHome({ ...router, canGoBack: () => true });
  expect(actions).toEqual(["/", "back"]);
});
