import type { SecureStorage } from "../preferences";

export const pilotPendingKey = (owner: string) => `tap.sponsor.pending.v1.${owner.toLowerCase()}`;

// A saved terminal assertion is not enough: only verified reconciliation plus
// explicit dismissal removes the journal. Unreadable/corrupt storage blocks fallback.
export async function hasUnresolvedPilot(storage: SecureStorage, owner: string): Promise<boolean> {
  try {
    const raw = await storage.getItemAsync(pilotPendingKey(owner));
    return raw !== null && JSON.parse(raw) !== null;
  } catch {
    return true;
  }
}
