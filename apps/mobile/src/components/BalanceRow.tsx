import type { Address, WalletBalances } from "@tap/core";
import { DEFAULT_TOKEN, getWalletBalances } from "@tap/core";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { copy } from "../copy";
import { faucetUrls, openFaucet } from "../faucets";
import { useSettings } from "../settings-store";
import { theme } from "../theme";

const FAKE_BALANCES: WalletBalances = {
  gas: { symbol: "ETH", amount: 50_000_000_000_000_000n, display: "0.05" },
  tokens: [{ address: DEFAULT_TOKEN, symbol: "USDC", amount: 12_000_000n, display: "$12.00" }],
};

export function BalanceRow({ address }: { address: Address }) {
  const [settings] = useSettings();
  const [result, setResult] = useState<{ value: WalletBalances; refresh: number } | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const balances = result?.refresh === refresh ? result.value : null;

  useFocusEffect(
    useCallback(() => {
      setResult(null);
      setUnavailable(false);
      if (settings.fakeChain) {
        setResult({ value: FAKE_BALANCES, refresh });
        setUnavailable(false);
        return;
      }

      let cancelled = false;
      (async () => {
        try {
          const next = await getWalletBalances(address);
          if (cancelled) return;
          setResult({ value: next, refresh });
          setUnavailable(false);
        } catch {
          if (cancelled) return;
          setResult(null);
          setUnavailable(true);
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [address, settings.fakeChain, refresh]),
  );

  if (!balances) {
    return (
      <View style={styles.card}>
        <Text style={styles.muted}>
          {unavailable ? "Balances unavailable" : "Loading balances…"}
        </Text>
        {unavailable ? (
          <Pressable accessibilityRole="button" onPress={() => setRefresh((value) => value + 1)}>
            <Text style={styles.fundingLink}>{copy.entry.balanceRetry}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  const usdc = balances.tokens.find((token) => token.symbol === "USDC");
  const needsGas = balances.gas.amount === 0n;
  const needsUsdc = usdc?.amount === 0n;

  function fund(url: string) {
    void openFaucet(url, address).catch(() => {
      Alert.alert("Couldn't open faucet", "Your address was copied. Open the faucet in a browser.");
    });
  }

  return (
    <View style={styles.card}>
      <View style={styles.assets}>
        {balances.tokens.map((token) => (
          <View key={token.address} style={styles.asset}>
            <Text style={styles.assetLabel}>{token.symbol}</Text>
            <Text style={styles.assetValue}>{token.display}</Text>
          </View>
        ))}
        <View style={styles.asset}>
          <Text style={styles.assetLabel}>{balances.gas.symbol}</Text>
          <Text style={styles.assetValue}>{balances.gas.display}</Text>
        </View>
      </View>
      {needsGas ? (
        <View style={styles.fundingRow}>
          <Text style={styles.warning}>Add Base Sepolia ETH for gas</Text>
          <Pressable
            accessibilityRole="link"
            hitSlop={8}
            onPress={() => fund(faucetUrls.baseSepoliaEth)}
          >
            <Text style={styles.fundingLink}>Get test ETH</Text>
          </Pressable>
        </View>
      ) : null}
      {needsUsdc ? (
        <View style={styles.fundingRow}>
          <Text style={styles.warning}>Add USDC to pay</Text>
          <Pressable
            accessibilityRole="link"
            hitSlop={8}
            onPress={() => fund(faucetUrls.baseSepoliaUsdc)}
          >
            <Text style={styles.fundingLink}>Get test USDC</Text>
          </Pressable>
        </View>
      ) : null}
      {needsGas || needsUsdc ? (
        <Text style={styles.faucetHint}>Your wallet address is copied when a faucet opens.</Text>
      ) : null}
      <Pressable accessibilityRole="button" onPress={() => setRefresh((value) => value + 1)}>
        <Text style={styles.fundingLink}>{copy.entry.balanceRetry}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderColor: theme.colors.line,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    gap: theme.spacing,
    padding: theme.spacing * 1.5,
  },
  assets: { flexDirection: "row", gap: theme.spacing * 3 },
  asset: { gap: 2 },
  assetLabel: { ...theme.type.label, color: theme.colors.muted, fontSize: 9 },
  assetValue: { color: theme.colors.foreground, fontSize: 17, fontWeight: "600" },
  muted: { color: theme.colors.muted, fontSize: 14 },
  warning: { color: theme.colors.warning, fontSize: 13 },
  fundingRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing,
    justifyContent: "space-between",
  },
  fundingLink: { ...theme.type.label, color: theme.colors.accent, fontSize: 10 },
  faucetHint: { color: theme.colors.muted, fontSize: 11, lineHeight: 16 },
});
