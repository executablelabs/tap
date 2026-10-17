import { type Address, type Hash, type Hex, isAddressEqual, recoverMessageAddress } from "viem";
import { PILOT_ACCOUNT_STACK } from "../config/chains";

export type PilotChallenge = {
  id: string;
  audience: string;
  owner: Address;
  payer: Address;
  requestHash: Hash;
  callDataHash: Hash;
  expiresAt: number;
};
export type PilotAction = "prepare" | "submit" | "status";

export function pilotProofMessage(challenge: PilotChallenge, action: PilotAction): string {
  return [
    "Tap sponsored USDC pilot",
    `Action: ${action}`,
    `Audience: ${challenge.audience}`,
    `Chain: ${PILOT_ACCOUNT_STACK.chainId}`,
    `Account version: ${PILOT_ACCOUNT_STACK.version}`,
    `Owner: ${challenge.owner.toLowerCase()}`,
    `Payer: ${challenge.payer.toLowerCase()}`,
    `Request: ${challenge.requestHash}`,
    `Calls: ${challenge.callDataHash}`,
    `Intent: ${challenge.id}`,
    `Prepare expires: ${challenge.expiresAt}`,
  ].join("\n");
}

export async function verifyPilotProof(
  challenge: PilotChallenge,
  action: PilotAction,
  signature: Hex,
): Promise<boolean> {
  try {
    return isAddressEqual(
      await recoverMessageAddress({ message: pilotProofMessage(challenge, action), signature }),
      challenge.owner,
    );
  } catch {
    return false;
  }
}
