import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { BalanceRow } from "../src/components/BalanceRow";
import { Button } from "../src/components/Button";
import { ScreenHeader } from "../src/components/ScreenHeader";
import { copy } from "../src/copy";
import { theme } from "../src/theme";
import { useWallet } from "../src/wallet/WalletProvider";

export default function HomeScreen() {
  const router = useRouter();
  const { address } = useWallet();
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ScreenHeader label={copy.entry.home} value={copy.labels.yourWallet} showBack={false} />
      <Text style={styles.note}>{copy.entry.testnet}</Text>
      <Text style={styles.title}>{copy.entry.ready}</Text>
      <Text style={styles.body}>{copy.entry.homeDetail}</Text>
      <Text selectable style={styles.address}>
        {address}
      </Text>
      {address ? <BalanceRow key={address} address={address} /> : null}
      <Button label={copy.entry.scan} onPress={() => router.push("/customer")} />
      <View style={styles.merchant}>
        <Text style={styles.body}>{copy.entry.merchantDetail}</Text>
        <Button
          label={copy.entry.merchant}
          variant="quiet"
          onPress={() => router.push("/merchant")}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, gap: theme.spacing * 2, padding: theme.spacing * 3 },
  title: { ...theme.type.display, color: theme.colors.foreground, fontSize: 38 },
  note: { color: theme.colors.warning, fontSize: 13 },
  body: { color: theme.colors.muted, fontSize: 15, lineHeight: 23 },
  address: { color: theme.colors.foreground, fontSize: 13 },
  merchant: { gap: theme.spacing * 1.5, marginTop: theme.spacing * 2 },
});
