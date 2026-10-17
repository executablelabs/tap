import {
  type Address,
  assertPilotOperation,
  assertPilotPayment,
  decodeRequestUrl,
  getPilotReceipt,
  type Hash,
  type Hex,
  hashRequest,
  type LocalAccount,
  type PilotAccount,
  type PilotChallenge,
  type PilotLimits,
  type PilotOperationWire,
  type PilotStatus,
  parsePilotOperation,
  pilotOperationHash,
  pilotOperationWire,
  pilotPaymentCallHash,
  pilotProofMessage,
  reconcilePilotReceipt,
  signPilotOperation,
  verifyRequest,
} from "@tap/core";
import type { PilotConsent, SecureStorage } from "../preferences";
import { pilotPendingKey } from "./pending";

export type PilotRemoteStatus = {
  id: string;
  status: PilotStatus;
  userOperationHash: string | null;
  transactionHash: string | null;
};
export type PilotRemote = {
  available(): Promise<boolean>;
  challenge(input: {
    owner: Address;
    requestUrl: string;
    idempotencyKey: string;
  }): Promise<{ challenge: PilotChallenge; callData: Hex }>;
  prepare(input: {
    id: string;
    proof: Hex;
  }): Promise<PilotRemoteStatus & { operation: PilotOperationWire | null }>;
  submit(input: { id: string; proof: Hex; signature: Hex }): Promise<PilotRemoteStatus>;
  status(input: { id: string; proof: Hex }): Promise<PilotRemoteStatus>;
};
type Pending = {
  version: 1;
  owner: Address;
  payer: Address;
  requestUrl: string;
  challenge: PilotChallenge;
  operation: PilotOperationWire | null;
  userOperationHash: Hash | null;
  status: PilotStatus;
};
export type PilotSessionState = "idle" | "unavailable" | "rejected" | PilotStatus;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const hash = (value: unknown): value is Hash =>
  typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
const activeOwners = new Set<string>();

// Native-free coordination, not a new signer or global wallet. A future verified
// transport must be injected; the app does not construct a live transport today.
export function createPilotPaymentSession(options: {
  owner: LocalAccount;
  account: PilotAccount;
  consent: PilotConsent | null;
  audience: string;
  limits: PilotLimits;
  context: { deployed: boolean; paymaster: Address };
  remote: PilotRemote;
  storage: SecureStorage;
  verify?: typeof verifyRequest;
  receipt?: typeof getPilotReceipt;
}) {
  const { owner, account, remote, storage } = options;
  const key = pilotPendingKey(owner.address);
  let state: PilotSessionState = "idle";
  let pending: Pending | null = null;
  let busy = false;
  let loaded = false;
  let corrupt = false;
  async function save() {
    await storage.setItemAsync(key, JSON.stringify(pending));
  }
  async function load() {
    if (loaded) return;
    try {
      const raw = await storage.getItemAsync(key);
      const value: unknown = raw === null ? null : JSON.parse(raw);
      if (value === null && pending) throw new Error("Known pending journal disappeared");
      if (value !== null) {
        if (
          typeof value !== "object" ||
          !("version" in value) ||
          value.version !== 1 ||
          !("owner" in value) ||
          typeof value.owner !== "string" ||
          !same(value.owner, owner.address) ||
          !("payer" in value) ||
          typeof value.payer !== "string" ||
          !same(value.payer, account.payer) ||
          !("challenge" in value) ||
          !value.challenge ||
          !("requestUrl" in value) ||
          typeof value.requestUrl !== "string"
        )
          throw new Error("Invalid pending pilot record");
        pending = value as Pending;
        const signed = decodeRequestUrl(pending.requestUrl);
        if (
          pending.challenge.requestHash !== hashRequest(signed.request, signed.chainId) ||
          pending.challenge.callDataHash !== pilotPaymentCallHash(signed) ||
          !same(pending.challenge.owner, owner.address) ||
          !same(pending.challenge.payer, account.payer) ||
          pending.challenge.audience !== options.audience
        )
          throw new Error("Pending pilot identity changed");
        if (pending.operation) {
          const op = parsePilotOperation(pending.operation);
          assertPilotPayment(signed, op.callData);
          if (
            !same(op.sender, account.payer) ||
            op.signature !== "0x" ||
            !hash(pending.userOperationHash) ||
            pending.userOperationHash !== pilotOperationHash(op)
          )
            throw new Error("Invalid pending operation");
        } else if (pending.userOperationHash !== null) throw new Error("Missing pending operation");
        state = "unknown"; // Persisted terminal assertions must be rechecked against chain evidence.
      }
      corrupt = false;
      loaded = true;
    } catch {
      corrupt = true;
      state = "unknown";
    }
  }
  async function proof(action: "prepare" | "submit" | "status") {
    if (!pending) throw new Error("Missing pilot challenge");
    return owner.signMessage({ message: pilotProofMessage(pending.challenge, action) });
  }
  async function refresh() {
    if (!pending) return;
    const status = await remote.status({ id: pending.challenge.id, proof: await proof("status") });
    if (
      status.id !== pending.challenge.id ||
      (pending.userOperationHash && status.userOperationHash !== pending.userOperationHash)
    )
      throw new Error("Pilot operation changed");
    state = "unknown";
    if (pending.operation && hash(status.transactionHash)) {
      const receipt = await (options.receipt ?? getPilotReceipt)(status.transactionHash);
      if (receipt.transactionHash !== status.transactionHash)
        throw new Error("Pilot receipt changed");
      state = reconcilePilotReceipt(
        parsePilotOperation(pending.operation),
        decodeRequestUrl(pending.requestUrl),
        receipt,
      );
    }
    pending.status = state;
    await save();
  }
  return {
    getState: () => state,
    hasPending: () => pending !== null || corrupt || activeOwners.has(key),
    load,
    // Called only by an explicit owner Pay action after opt-in and verified display.
    async confirm(requestUrl: string): Promise<PilotSessionState> {
      if (busy || activeOwners.has(key)) return "unknown";
      busy = true;
      activeOwners.add(key);
      try {
        loaded = false;
        await load();
        if (pending || corrupt) return state;
        const consent = options.consent;
        if (
          !consent ||
          !same(consent.owner, owner.address) ||
          !same(consent.payer, account.payer) ||
          consent.version !== account.version ||
          consent.chainId !== account.chainId ||
          !same(account.owner, owner.address) ||
          same(account.payer, owner.address) ||
          !(await remote.available())
        ) {
          state = "unavailable";
          return state;
        }
        const signed = decodeRequestUrl(requestUrl);
        if (!(await (options.verify ?? verifyRequest)(signed)).ok) {
          state = "rejected";
          return state;
        }
        const bytes = crypto.getRandomValues(new Uint8Array(16));
        const idempotencyKey = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
          "",
        );
        const result = await remote.challenge({ owner: owner.address, requestUrl, idempotencyKey });
        const ch = result.challenge;
        if (
          !same(ch.owner, owner.address) ||
          !same(ch.payer, account.payer) ||
          ch.audience !== options.audience ||
          ch.requestHash !== hashRequest(signed.request, signed.chainId) ||
          ch.callDataHash !== pilotPaymentCallHash(signed) ||
          !Number.isSafeInteger(ch.expiresAt) ||
          ch.expiresAt <= Date.now() ||
          ch.expiresAt > Number(signed.request.expiry) * 1000
        )
          throw new Error("Untrusted pilot challenge");
        pending = {
          version: 1,
          owner: owner.address,
          payer: account.payer,
          requestUrl,
          challenge: ch,
          operation: null,
          userOperationHash: null,
          status: "unknown",
        };
        state = "unknown";
        await save(); // No prepare proof or provider authorization before durable tracking.
        const prepared = await remote.prepare({ id: ch.id, proof: await proof("prepare") });
        if (prepared.id !== ch.id || prepared.status !== "prepared" || !prepared.operation)
          return state;
        const op = parsePilotOperation(prepared.operation);
        assertPilotOperation(op, account, signed, options.limits, options.context);
        if (op.signature !== "0x") throw new Error("Untrusted prepared signature");
        if (!(await (options.verify ?? verifyRequest)(signed)).ok)
          throw new Error("Merchant changed before owner authorization");
        pending.operation = pilotOperationWire(op);
        pending.userOperationHash = pilotOperationHash(op);
        await save();
        const signature = await signPilotOperation(
          owner,
          account,
          op,
          signed,
          options.limits,
          options.context,
        );
        pending.status = "submitting";
        await save(); // Persist exact identity before a potentially ambiguous HTTP submission.
        await remote.submit({ id: ch.id, proof: await proof("submit"), signature });
        await refresh();
        return state;
      } catch {
        state = pending || corrupt ? "unknown" : "unavailable";
        return state;
      } finally {
        busy = false;
        activeOwners.delete(key);
      }
    },
    async checkPending(): Promise<PilotSessionState> {
      if (busy || activeOwners.has(key)) return "unknown";
      busy = true;
      activeOwners.add(key);
      try {
        loaded = false;
        await load();
        if (!corrupt && pending) await refresh();
      } catch {
        state = "unknown";
      } finally {
        busy = false;
        activeOwners.delete(key);
      }
      return state;
    },
    async dismissResolved(): Promise<boolean> {
      if (
        busy ||
        activeOwners.has(key) ||
        corrupt ||
        !pending ||
        (state !== "paid" && state !== "reverted")
      )
        return false;
      activeOwners.add(key);
      try {
        const raw = await storage.getItemAsync(key);
        const current = raw === null ? null : (JSON.parse(raw) as Pending);
        if (current?.challenge?.id !== pending.challenge.id) return false;
        await storage.setItemAsync(key, "null");
        pending = null;
        state = "idle";
        return true;
      } finally {
        activeOwners.delete(key);
      }
    },
  };
}
