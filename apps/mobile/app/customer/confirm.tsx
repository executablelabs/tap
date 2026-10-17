import { formatTokenUnits, type LocalAccount } from "@tap/core";
import { createFakeCore } from "@tap/core/testing";
import { useTapToPay } from "@tap/react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "../../src/components/Button";
import { MerchantCard } from "../../src/components/MerchantCard";
import { StatusView } from "../../src/components/StatusView";
import { copy } from "../../src/copy";
import { hapticFailure, hapticSuccess } from "../../src/haptics";
import { useSettings } from "../../src/settings-store";
import { hasUnresolvedPilot } from "../../src/sponsorship/pending";
import { theme } from "../../src/theme";
import { useWallet } from "../../src/wallet/WalletProvider";

function DoneButton({ onPress }: { onPress(): void }) {
  return <Button label={copy.entry.done} variant="secondary" onPress={onPress} />;
}

function AssetOption({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.assetOption, selected && styles.assetOptionActive]}
      onPress={onPress}
    >
      <Text style={[styles.assetOptionText, selected && styles.assetOptionTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function ConfirmView({ account, url }: { account: LocalAccount; url: string }) {
  const router = useRouter();
  const [settings] = useSettings();
  const core = useMemo(
    () => (settings.fakeChain ? createFakeCore() : undefined),
    [settings.fakeChain],
  );
  const pay = useTapToPay({ account, core });
  const [paymentAsset, setPaymentAsset] = useState<"usdc" | "eth">("usdc");
  const [pilotBlocked, setPilotBlocked] = useState(false);
  const submitted = useRef(false);
  const { submitUrl } = pay;

  useEffect(() => {
    if (submitted.current) return;
    submitted.current = true;
    void submitUrl(url);
  }, [url, submitUrl]);

  useEffect(() => {
    if (pay.state === "paid") hapticSuccess();
    if (pay.state === "rejected" || pay.state === "failed" || pay.state === "error") {
      hapticFailure();
    }
  }, [pay.state]);

  const done = () => router.dismissTo("/");
  if (pilotBlocked)
    return (
      <StatusView variant="pending" title={copy.pilot.pending} detail={copy.pilot.pendingDetail}>
        <DoneButton onPress={done} />
      </StatusView>
    );

  // INV-17: the ONLY branch that may render a Pay button or reach confirm().
  // The guard narrows verify to its ok:true variant, so displayAmount and
  // ensName are unreachable outside it.
  if (pay.state === "verified" && pay.verify?.ok === true) {
    const verified = pay.verify;
    const ethQuote = pay.quoteState === "ready" ? pay.swapQuote : undefined;
    const payDisabled = paymentAsset === "eth" && !ethQuote;
    const selectAsset = (asset: "usdc" | "eth") => {
      setPaymentAsset(asset);
      if (asset === "eth") void pay.requestSwapQuote("native");
    };
    return (
      <View style={styles.container}>
        <MerchantCard
          displayName={verified.displayName}
          ensName={verified.ensName}
          amount={verified.displayAmount}
          expiresAt={verified.expiresAt}
        />

        <View style={styles.payWith}>
          <Text style={styles.payWithLabel}>{copy.labels.payWith}</Text>
          <View style={styles.assetPicker}>
            <AssetOption
              label="USDC"
              selected={paymentAsset === "usdc"}
              onPress={() => selectAsset("usdc")}
            />
            <AssetOption
              label="ETH"
              selected={paymentAsset === "eth"}
              onPress={() => selectAsset("eth")}
            />
          </View>
          {paymentAsset === "eth" ? (
            <Text style={[styles.quoteText, pay.quoteState === "failed" && styles.quoteError]}>
              {ethQuote
                ? `Maximum ${formatTokenUnits(ethQuote.amountInMaximum, 18)} ETH`
                : pay.quoteState === "failed"
                  ? copy.getErrorMessage(pay.quoteError?.code)
                  : "Getting ETH quote…"}
            </Text>
          ) : null}
        </View>

        <View style={styles.actions}>
          <Button
            label={`Pay ${verified.displayAmount} in ${paymentAsset === "eth" ? "ETH" : "USDC"}`}
            disabled={payDisabled}
            onPress={() =>
              void (async () => {
                if (await hasUnresolvedPilot(SecureStore, account.address)) setPilotBlocked(true);
                else await pay.confirm(paymentAsset === "eth" ? ethQuote : undefined);
              })()
            }
          />
          <Button label="Not now" variant="quiet" onPress={done} />
        </View>
      </View>
    );
  }

  if (pay.state === "rejected") {
    return (
      <StatusView
        variant="failure"
        title="Unverified merchant"
        detail={copy.getErrorMessage(pay.verify?.ok === false ? pay.verify.reason : null)}
      >
        <DoneButton onPress={done} />
      </StatusView>
    );
  }

  const settled = pay.verify?.ok === true ? pay.verify : null;

  if (pay.state === "paying") {
    return <StatusView variant="pending" title={settled?.displayAmount ?? ""} detail="Paying…" />;
  }

  if (pay.state === "paid") {
    const merchant = settled ? (settled.displayName ?? settled.ensName) : "";
    return (
      <StatusView
        variant="success"
        title={`Paid ${merchant} ${settled?.displayAmount ?? ""}`.replace(/\s+/g, " ").trim()}
      >
        <DoneButton onPress={done} />
      </StatusView>
    );
  }

  if (pay.state === "failed") {
    const detail =
      paymentAsset === "eth" && pay.error?.code === "insufficient_funds"
        ? "Not enough ETH to pay."
        : copy.getErrorMessage(pay.error?.code);
    return (
      <StatusView variant="failure" title="Payment failed" detail={detail}>
        <DoneButton onPress={done} />
      </StatusView>
    );
  }

  if (pay.state === "error") {
    return (
      <StatusView
        variant="failure"
        title="Couldn't read the tag"
        detail={copy.getErrorMessage(pay.error?.code)}
      >
        <DoneButton onPress={done} />
      </StatusView>
    );
  }

  return <StatusView variant="pending" title="Checking merchant…" />;
}

export default function CustomerConfirmScreen() {
  const { url } = useLocalSearchParams<{ url: string }>();
  const { account } = useWallet();
  const router = useRouter();
  const [pilotCheck, setPilotCheck] = useState<{
    owner: string;
    url: string;
    blocked: boolean;
  } | null>(null);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (account)
        void hasUnresolvedPilot(SecureStore, account.address).then((blocked) => {
          if (active) setPilotCheck({ owner: account.address, url, blocked });
        });
      return () => {
        active = false;
      };
    }, [account, url]),
  );

  if (typeof url !== "string" || !url) {
    return (
      <StatusView
        variant="failure"
        title="Unverified merchant"
        detail={copy.getErrorMessage("malformed")}
      >
        <DoneButton onPress={() => router.dismissTo("/")} />
      </StatusView>
    );
  }
  if (!account) return <StatusView variant="pending" title="Checking merchant…" />;
  if (!pilotCheck || pilotCheck.owner !== account.address || pilotCheck.url !== url)
    return <StatusView variant="pending" title={copy.entry.loading} />;
  if (pilotCheck.blocked)
    return (
      <StatusView variant="pending" title={copy.pilot.pending} detail={copy.pilot.pendingDetail}>
        <DoneButton onPress={() => router.dismissTo("/")} />
      </StatusView>
    );

  return <ConfirmView key={`${account.address}:${url}`} account={account} url={url} />;
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: theme.colors.background,
    flex: 1,
    gap: theme.spacing * 2.5,
    justifyContent: "center",
    padding: theme.spacing * 3,
  },
  actions: { gap: theme.spacing * 1.5 },
  payWith: { gap: theme.spacing },
  payWithLabel: { ...theme.type.label, color: theme.colors.muted, fontSize: 10 },
  assetPicker: {
    borderColor: theme.colors.line,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    padding: 3,
  },
  assetOption: {
    alignItems: "center",
    borderRadius: 6,
    flex: 1,
    justifyContent: "center",
    minHeight: 46,
  },
  assetOptionActive: { backgroundColor: theme.colors.accent },
  assetOptionText: { ...theme.type.label, color: theme.colors.muted, fontSize: 12 },
  assetOptionTextActive: { color: theme.colors.accentText },
  quoteText: { color: theme.colors.muted, fontSize: 13, textAlign: "center" },
  quoteError: { color: theme.colors.warning },
});
