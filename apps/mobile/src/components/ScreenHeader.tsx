import { Link, useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { copy } from "../copy";
import { backOrHome } from "../entry-state";
import { theme } from "../theme";

export function ScreenHeader({
  label,
  value,
  showBack = true,
}: {
  label: string;
  value: string;
  showBack?: boolean;
}) {
  const router = useRouter();

  return (
    <View style={styles.header}>
      {showBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.entry.back}
          hitSlop={12}
          onPress={() => backOrHome(router)}
        >
          <Text style={styles.back}>←</Text>
        </Pressable>
      ) : null}
      <View style={styles.identity}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.value} numberOfLines={1}>
          {value}
        </Text>
      </View>
      <Link href="/settings" style={styles.settings} accessibilityLabel="Settings">
        ⚙︎
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    borderBottomColor: theme.colors.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: theme.spacing * 1.5,
    justifyContent: "space-between",
    paddingBottom: theme.spacing * 1.5,
  },
  back: { color: theme.colors.muted, fontSize: 22 },
  identity: { flexGrow: 1, flexShrink: 1, gap: 2 },
  label: { ...theme.type.label, color: theme.colors.muted, fontSize: 9 },
  value: { color: theme.colors.foreground, fontSize: 16, fontWeight: "600" },
  settings: { color: theme.colors.muted, fontSize: 20 },
});
