import type { ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { copy } from "../copy";
import { entryStage } from "../entry-state";
import { preferencesStore, usePreferencesStatus, useSettings } from "../settings-store";
import { theme } from "../theme";
import { useWallet } from "../wallet/WalletProvider";
import { Button } from "./Button";
import { StatusView } from "./StatusView";

export function EntryGate({ children }: { children: ReactNode }) {
  const wallet = useWallet();
  const preferences = usePreferencesStatus();
  const [settings, update] = useSettings();
  const stage = entryStage({
    preferencesStatus: preferences.status,
    walletLoading: wallet.isLoading,
    walletAvailable: wallet.account !== null,
    onboardingSaved: preferences.onboardingSaved,
  });
  if (stage === "loading") return <StatusView variant="pending" title={copy.entry.loading} />;
  if (stage === "wallet-error" || stage === "preferences-error") {
    const isWallet = stage === "wallet-error";
    return (
      <StatusView
        variant="failure"
        title={isWallet ? copy.entry.walletError : copy.entry.preferencesError}
        detail={isWallet ? copy.entry.walletRecovery : copy.entry.preferencesRecovery}
      >
        <Button
          label={copy.entry.retry}
          onPress={() => void (isWallet ? wallet.retryWallet() : preferencesStore.hydrate())}
        />
        {!isWallet ? (
          <Button
            label={copy.entry.resetPreferences}
            variant="quiet"
            onPress={() => void preferencesStore.reset()}
          />
        ) : null}
      </StatusView>
    );
  }
  if (stage === "onboarding") {
    return (
      <ScrollView contentContainerStyle={styles.intro}>
        <Text style={styles.note}>{copy.entry.testnet}</Text>
        <Text style={styles.title}>{copy.entry.welcome}</Text>
        <Text style={styles.subtitle}>{copy.entry.introduction}</Text>
        <Text style={styles.body}>{copy.entry.deviceWallet}</Text>
        <Text style={styles.body}>{copy.entry.verification}</Text>
        <Text style={styles.subtitle}>{copy.entry.preference}</Text>
        {(["nfc", "qr"] as const).map((transport) => (
          <Button
            key={transport}
            label={`${settings.transport === transport ? "• " : ""}${copy.entry[transport]}`}
            variant="secondary"
            onPress={() => update({ transport })}
          />
        ))}
        {preferences.saveError ? (
          <Text accessibilityRole="alert" style={styles.note}>
            {copy.entry.saveError}
          </Text>
        ) : null}
        <Button
          label={preferences.saving ? copy.entry.saving : copy.entry.continue}
          disabled={preferences.saving}
          onPress={() => update({ onboardingComplete: true })}
        />
      </ScrollView>
    );
  }
  return (
    <View style={styles.ready}>
      {preferences.saveError ? (
        <Button
          label={copy.entry.saveError}
          variant="quiet"
          onPress={() => void preferencesStore.retrySave()}
        />
      ) : null}
      <View style={styles.ready}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  ready: { flex: 1 },
  intro: {
    flexGrow: 1,
    justifyContent: "center",
    gap: theme.spacing * 2,
    padding: theme.spacing * 3,
  },
  title: { ...theme.type.display, color: theme.colors.foreground, fontSize: 38 },
  subtitle: { color: theme.colors.foreground, fontSize: 19 },
  body: { color: theme.colors.muted, fontSize: 15, lineHeight: 23 },
  note: { color: theme.colors.warning, fontSize: 13 },
});
