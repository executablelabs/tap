import { type Address, getPilotAccount, type PilotAccount } from "@tap/core";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { copy } from "../copy";
import { useSettings } from "../settings-store";
import { theme } from "../theme";
import { Button } from "./Button";

export function PilotAccountCard({
  owner,
  derive = getPilotAccount,
}: {
  owner: Address;
  derive?: typeof getPilotAccount;
}) {
  const [settings, update] = useSettings();
  const [preview, setPreview] = useState<PilotAccount | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const selected = settings.pilotConsent?.owner.toLowerCase() === owner.toLowerCase();
  async function showPreview() {
    setBusy(true);
    setFailed(false);
    try {
      setPreview(await derive(owner));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{copy.pilot.title}</Text>
      <Text style={styles.note}>{copy.pilot.inactive}</Text>
      <Text style={styles.body}>{copy.pilot.explanation}</Text>
      <Button
        label={busy ? copy.entry.loading : copy.pilot.preview}
        variant="quiet"
        disabled={busy}
        onPress={() => void showPreview()}
      />
      {failed ? (
        <Text accessibilityRole="alert" style={styles.note}>
          {copy.pilot.previewFailed}
        </Text>
      ) : null}
      {preview && preview.owner.toLowerCase() === owner.toLowerCase() ? (
        <>
          <Text style={styles.body}>{copy.pilot.owner}</Text>
          <Text selectable style={styles.body}>
            {owner}
          </Text>
          <Text style={styles.body}>{copy.pilot.payer}</Text>
          <Text selectable style={styles.body}>
            {preview.payer}
          </Text>
          <Text style={styles.body}>{copy.pilot.noMigration}</Text>
          <Button
            label={selected ? copy.pilot.selected : copy.pilot.optIn}
            variant="secondary"
            disabled={selected}
            onPress={() =>
              update({
                pilotConsent: {
                  owner,
                  payer: preview.payer,
                  version: preview.version,
                  chainId: preview.chainId,
                },
              })
            }
          />
        </>
      ) : null}
      {selected ? (
        <Button
          label={copy.pilot.optOut}
          variant="quiet"
          onPress={() => update({ pilotConsent: null })}
        />
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  card: { gap: theme.spacing * 1.25 },
  title: { ...theme.type.label, color: theme.colors.foreground, fontSize: 12 },
  body: { color: theme.colors.muted, fontSize: 13, lineHeight: 19 },
  note: { color: theme.colors.warning, fontSize: 13 },
});
