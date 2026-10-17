import "react-native-get-random-values";

import { configureTap } from "@tap/core";
import { Stack } from "expo-router";
import { useEffect } from "react";
import { StatusBar, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { EntryGate } from "../src/components/EntryGate";
import { copy } from "../src/copy";
import { resetHceSession } from "../src/hce-session";
import { preferencesStore, useSettings } from "../src/settings-store";
import { theme } from "../src/theme";
import { WalletProvider } from "../src/wallet/WalletProvider";

configureTap({
  rpcUrls: {
    payment: process.env.EXPO_PUBLIC_BASE_SEPOLIA_RPC,
    ens: process.env.EXPO_PUBLIC_SEPOLIA_RPC,
  },
});

function FakeChainChip() {
  const [settings] = useSettings();
  if (!settings.fakeChain) return null;

  return (
    <View style={styles.chip} pointerEvents="none">
      <Text style={styles.chipText}>{copy.entry.fakeChain}</Text>
    </View>
  );
}

function Shell() {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.shell, { paddingBottom: insets.bottom, paddingTop: insets.top }]}>
      <Stack
        screenLayout={({ children }) => <EntryGate>{children}</EntryGate>}
        screenOptions={{
          animation: "fade",
          contentStyle: { backgroundColor: theme.colors.background },
          headerShown: false,
        }}
      />
      <FakeChainChip />
    </View>
  );
}

export default function RootLayout() {
  useEffect(() => {
    void preferencesStore.hydrate();
    void resetHceSession().catch(() => undefined);
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      <WalletProvider>
        <Shell />
      </WalletProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  shell: { backgroundColor: theme.colors.background, flex: 1 },
  chip: {
    alignSelf: "center",
    backgroundColor: theme.colors.failure,
    borderRadius: theme.radius.pill,
    bottom: theme.spacing * 2,
    paddingHorizontal: theme.spacing * 1.5,
    paddingVertical: theme.spacing / 2,
    position: "absolute",
  },
  chipText: { ...theme.type.label, color: theme.colors.surface, fontSize: 9 },
});
