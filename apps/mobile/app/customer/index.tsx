import { cancelRead, readRequest, TransportError } from "@tap/react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { BalanceRow } from "../../src/components/BalanceRow";
import { Button } from "../../src/components/Button";
import { QrScanner } from "../../src/components/QrScanner";
import { ScreenHeader } from "../../src/components/ScreenHeader";
import { copy } from "../../src/copy";
import { hapticTap } from "../../src/haptics";
import { createReadSession } from "../../src/read-session";
import { useSettings } from "../../src/settings-store";
import { theme } from "../../src/theme";
import { useWallet } from "../../src/wallet/WalletProvider";

const READ_TIMEOUT_MS = 30_000;

function codeOf(error: unknown): string | null {
  return error instanceof TransportError ? error.code : null;
}

function ReadyPulse() {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1_200, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1_200, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      style={[
        styles.pulseRing,
        {
          opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
          transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] }) }],
        },
      ]}
    >
      <Text style={styles.pulseWaves}>)))</Text>
    </Animated.View>
  );
}

export default function CustomerReadyScreen() {
  const router = useRouter();
  const [settings] = useSettings();
  const { address } = useWallet();
  const [readError, setReadError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [reading, setReading] = useState(false);
  const session = useMemo(
    () =>
      createReadSession({
        read: () => readRequest({ timeoutMs: READ_TIMEOUT_MS }),
        cancel: cancelRead,
        onReading: setReading,
        onUrl(url) {
          hapticTap();
          router.replace({ pathname: "/customer/confirm", params: { url } });
        },
        onError: (error) => setReadError(copy.getErrorMessage(codeOf(error))),
      }),
    [router],
  );

  useFocusEffect(
    useCallback(() => {
      session.activate();
      return () => {
        session.deactivate();
        setScanning(false);
      };
    }, [session]),
  );

  if (scanning) {
    return (
      <QrScanner
        onScan={(url) => {
          hapticTap();
          setScanning(false);
          router.replace({ pathname: "/customer/confirm", params: { url } });
        }}
        onCancel={() => setScanning(false)}
      />
    );
  }

  const isWaiting = reading;

  return (
    <View style={styles.container}>
      <ScreenHeader
        label={copy.labels.yourWallet}
        value={address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "Loading…"}
      />

      {address ? <BalanceRow address={address} /> : null}

      <View style={styles.stage}>
        {isWaiting ? <ReadyPulse /> : null}
        <Text style={styles.prompt}>
          {isWaiting ? "Hold near the merchant's phone" : "Ready when you are"}
        </Text>
        {readError ? <Text style={styles.error}>{readError}</Text> : null}
      </View>

      <View style={styles.footer}>
        <Button
          label={reading ? copy.scan.cancel : copy.scan.start}
          variant={settings.transport === "nfc" ? "primary" : "secondary"}
          onPress={() => {
            setReadError(null);
            if (reading) session.cancel();
            else void session.start();
          }}
        />
        <Button
          label={copy.scan.qr}
          variant={settings.transport === "qr" ? "primary" : "secondary"}
          onPress={() => {
            session.cancel();
            setReadError(null);
            setScanning(true);
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: theme.colors.background,
    flex: 1,
    gap: theme.spacing * 2,
    padding: theme.spacing * 3,
  },
  stage: { alignItems: "center", flex: 1, gap: theme.spacing * 3, justifyContent: "center" },
  pulseRing: {
    alignItems: "center",
    borderColor: theme.colors.accent,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    height: 168,
    justifyContent: "center",
    width: 168,
  },
  pulseWaves: {
    ...theme.type.display,
    color: theme.colors.accent,
    fontSize: 52,
    letterSpacing: -7,
    transform: [{ rotate: "-90deg" }],
  },
  prompt: {
    ...theme.type.display,
    color: theme.colors.foreground,
    fontSize: 32,
    lineHeight: 36,
    textAlign: "center",
  },
  error: { color: theme.colors.warning, fontSize: 14, textAlign: "center" },
  footer: { gap: theme.spacing * 1.5 },
});
