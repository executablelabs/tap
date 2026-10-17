import {
  ENS_PARENT,
  isMerchantLabelAvailable,
  isUnderParent,
  registerMerchant,
  TapError,
} from "@tap/core";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Button } from "../../src/components/Button";
import { ScreenHeader } from "../../src/components/ScreenHeader";
import { StatusView } from "../../src/components/StatusView";
import { copy } from "../../src/copy";
import { faucetUrls, openFaucet } from "../../src/faucets";
import { useSettings } from "../../src/settings-store";
import { theme } from "../../src/theme";
import { useWallet } from "../../src/wallet/WalletProvider";

type Availability = "idle" | "checking" | "available" | "taken" | "unavailable";

function initialLabel(merchantName: string): string {
  const suffix = `.${ENS_PARENT}`;
  const normalized = merchantName.trim().toLowerCase();
  return normalized.endsWith(suffix) ? normalized.slice(0, -suffix.length) : "";
}

export default function RegisterMerchantScreen() {
  const router = useRouter();
  const [settings, setSettings] = useSettings();
  const { account, address } = useWallet();
  const [label, setLabel] = useState(() => initialLabel(settings.merchantName));
  const [displayName, setDisplayName] = useState("");
  const [availability, setAvailability] = useState<Availability>("idle");
  const [registering, setRegistering] = useState(false);
  const [registeredName, setRegisteredName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fullName = useMemo(() => `${label}.${ENS_PARENT}`, [label]);
  const validLabel = isUnderParent(fullName);

  useEffect(() => {
    if (!validLabel || settings.fakeChain) {
      setAvailability("idle");
      return;
    }

    let cancelled = false;
    setAvailability("checking");
    const timer = setTimeout(() => {
      void isMerchantLabelAvailable(label)
        .then((available) => {
          if (!cancelled) setAvailability(available ? "available" : "taken");
        })
        .catch(() => {
          if (!cancelled) setAvailability("unavailable");
        });
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [label, settings.fakeChain, validLabel]);

  async function register() {
    if (!account || availability !== "available") return;

    setRegistering(true);
    setError(null);
    try {
      await registerMerchant(
        { label, displayName: displayName.trim(), owner: account.address },
        account,
      );
      setSettings({ merchantName: fullName });
      setRegisteredName(fullName);
    } catch (caught) {
      const code = caught instanceof TapError ? caught.code : "registration_failed";
      setError(copy.getErrorMessage(code));
      if (code === "name_taken") setAvailability("taken");
    } finally {
      setRegistering(false);
    }
  }

  function fundMerchant() {
    if (!address) return;
    void openFaucet(faucetUrls.sepoliaEth, address).catch(() => {
      Alert.alert("Couldn't open faucet", "Your address was copied. Open the faucet in a browser.");
    });
  }

  if (registeredName) {
    return (
      <StatusView
        variant="success"
        title={registeredName}
        detail="Registered to this wallet and ready for live merchant verification."
      >
        <Button label="Start accepting payments" onPress={() => router.replace("/merchant")} />
      </StatusView>
    );
  }

  const availabilityCopy = !validLabel
    ? "Use 3-32 lowercase letters, numbers, or hyphens."
    : availability === "checking"
      ? "Checking availability..."
      : availability === "available"
        ? `${fullName} is available.`
        : availability === "taken"
          ? `${fullName} is already registered.`
          : availability === "unavailable"
            ? "Couldn't check availability. Check your Sepolia connection."
            : null;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <ScreenHeader label="Merchant setup" value="Sepolia ENS" />

      <View style={styles.intro}>
        <Text style={styles.title}>Claim your merchant name</Text>
        <Text style={styles.muted}>
          This name is bound to the wallet on this phone and shown to customers before they pay.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Merchant name</Text>
        <View style={styles.nameInputRow}>
          <TextInput
            style={styles.nameInput}
            value={label}
            onChangeText={(value) => {
              setLabel(value.trim().toLowerCase());
              setAvailability("idle");
              setError(null);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={32}
            placeholder="yoyogi-market"
            placeholderTextColor={theme.colors.muted}
          />
          <Text style={styles.suffix}>.{ENS_PARENT}</Text>
        </View>
        {availabilityCopy ? (
          <Text
            style={[
              styles.feedback,
              availability === "available" ? styles.available : styles.warning,
            ]}
          >
            {availabilityCopy}
          </Text>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Display name</Text>
        <TextInput
          style={styles.input}
          value={displayName}
          onChangeText={(value) => {
            setDisplayName(value);
            setError(null);
          }}
          autoCorrect={false}
          maxLength={64}
          placeholder="Yoyogi Market"
          placeholderTextColor={theme.colors.muted}
        />
        <Text style={styles.muted}>The human-readable name customers will verify.</Text>
      </View>

      <View style={styles.walletSection}>
        <Text style={styles.label}>Registration wallet</Text>
        <Text style={styles.address} selectable>
          {address ?? "Loading wallet..."}
        </Text>
        <Text style={styles.muted}>Registration needs a small amount of Sepolia ETH for gas.</Text>
        <Button
          label="Open Sepolia faucet"
          variant="quiet"
          disabled={!address}
          onPress={fundMerchant}
        />
        <Text style={styles.faucetHint}>
          Your wallet address is copied before the faucet opens.
        </Text>
      </View>

      {settings.fakeChain ? (
        <Text style={styles.warning}>
          Turn off Offline fake chain in Settings to register on Sepolia.
        </Text>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.footer}>
        <Button
          label={registering ? "Registering on Sepolia..." : `Register ${fullName}`}
          disabled={
            registering ||
            settings.fakeChain ||
            !account ||
            availability !== "available" ||
            displayName.trim().length === 0
          }
          onPress={() => void register()}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: theme.colors.background },
  container: {
    backgroundColor: theme.colors.background,
    flexGrow: 1,
    gap: theme.spacing * 3,
    padding: theme.spacing * 3,
    paddingBottom: theme.spacing * 5,
  },
  intro: { gap: theme.spacing },
  title: {
    ...theme.type.display,
    color: theme.colors.foreground,
    fontSize: 34,
    lineHeight: 39,
  },
  section: { gap: theme.spacing },
  walletSection: {
    borderColor: theme.colors.line,
    borderLeftWidth: 3,
    gap: theme.spacing,
    paddingLeft: theme.spacing * 1.5,
  },
  label: { ...theme.type.label, color: theme.colors.muted, fontSize: 10 },
  nameInputRow: { alignItems: "center", flexDirection: "row" },
  nameInput: {
    borderColor: theme.colors.line,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    color: theme.colors.foreground,
    flex: 1,
    fontSize: 16,
    minWidth: 0,
    padding: theme.spacing * 1.5,
  },
  suffix: { color: theme.colors.foreground, fontSize: 16, paddingLeft: theme.spacing },
  input: {
    borderColor: theme.colors.line,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    color: theme.colors.foreground,
    fontSize: 16,
    padding: theme.spacing * 1.5,
  },
  muted: { color: theme.colors.muted, fontSize: 13, lineHeight: 19 },
  feedback: { fontSize: 13, lineHeight: 19 },
  available: { color: theme.colors.success },
  warning: { color: theme.colors.warning, fontSize: 13, lineHeight: 19 },
  error: { color: theme.colors.failure, fontSize: 14, lineHeight: 20, textAlign: "center" },
  address: { color: theme.colors.foreground, fontSize: 12, lineHeight: 18 },
  faucetHint: { color: theme.colors.muted, fontSize: 11, lineHeight: 16, textAlign: "center" },
  footer: { marginTop: "auto" },
});
