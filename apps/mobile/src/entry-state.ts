export function entryStage(input: {
  preferencesStatus: "loading" | "ready" | "error";
  walletLoading: boolean;
  walletAvailable: boolean;
  onboardingSaved: boolean;
}): "loading" | "preferences-error" | "wallet-error" | "onboarding" | "ready" {
  if (input.preferencesStatus === "error") return "preferences-error";
  if (input.preferencesStatus === "loading" || input.walletLoading) return "loading";
  if (!input.walletAvailable) return "wallet-error";
  return input.onboardingSaved ? "ready" : "onboarding";
}

type BackRouter = { canGoBack(): boolean; back(): void; replace(path: "/"): void };
export function backOrHome(router: BackRouter): void {
  if (router.canGoBack()) router.back();
  else router.replace("/");
}
