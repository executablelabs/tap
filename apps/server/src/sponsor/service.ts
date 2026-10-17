import {
  type Address,
  assertPilotOperation,
  assertPilotPayment,
  decodeRequestUrl,
  encodePilotPayment,
  encodeRequestUrl,
  getPilotAccount,
  type Hash,
  type Hex,
  hashRequest,
  isPaid,
  PILOT_ACCOUNT_STACK,
  type PilotAccount,
  type PilotAction,
  type PilotOperation,
  type PilotReceipt,
  pilotOperationHash,
  pilotOperationWire,
  pilotPaymentCallHash,
  reconcilePilotReceipt,
  verifyPilotOperationOwner,
  verifyPilotProof,
  verifyRequest,
} from "@tap/core";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { SponsorIntent, SponsorLedger } from "./ledger";
import type { SponsorPolicy } from "./policy";

// No live gateway is constructed or mounted in this slice. Implementations must
// independently check deployed code/owner state and provider authorization binding.
export type SponsorGateway = {
  chainId: 84532;
  entryPoint: Address;
  assertAccount(account: PilotAccount): Promise<{ deployed: boolean; paymaster: Address }>;
  prepare(account: PilotAccount, callData: Hex): Promise<PilotOperation>;
  send(operation: PilotOperation): Promise<Hash>;
  locate(
    hash: Hash,
  ): Promise<{ userOpHash: Hash; transactionHash: Hash; sender: Address; nonce: bigint } | null>;
  canonicalReceipt(transactionHash: Hash): Promise<PilotReceipt>;
};
export type SponsorReadiness = {
  accountCode: boolean;
  providerBinding: boolean;
  persistentHost: boolean;
  rescue: boolean;
  device: boolean;
};
export type SponsorDependencies = {
  enabled: boolean;
  readiness: SponsorReadiness;
  policy: SponsorPolicy | null;
  ledger: SponsorLedger;
  gateway: SponsorGateway;
  deriveAccount?: typeof getPilotAccount;
  verify?: typeof verifyRequest;
  settled?: typeof isPaid;
  now?: () => number;
};

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const address = (value: unknown): Address => {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value))
    throw new Error("Invalid owner");
  return value.toLowerCase() as Address;
};
const text = (value: unknown, maximum: number): string => {
  if (typeof value !== "string" || !value || value.length > maximum)
    throw new Error("Invalid pilot text");
  return value;
};
const hex = (value: unknown): Hex => {
  const input = text(value, 4096);
  if (!/^0x[0-9a-fA-F]+$/.test(input) || input.length % 2 !== 0)
    throw new Error("Invalid pilot signature");
  return input as Hex;
};

export function createSponsorService(deps?: SponsorDependencies) {
  const service = new Hono();
  service.use("*", bodyLimit({ maxSize: 20_000 }));
  service.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });
  const ready = () =>
    !!(
      deps?.enabled &&
      deps.policy &&
      deps.readiness.accountCode &&
      deps.readiness.providerBinding &&
      deps.readiness.persistentHost &&
      deps.readiness.rescue &&
      deps.readiness.device &&
      deps.gateway.chainId === PILOT_ACCOUNT_STACK.chainId &&
      same(deps.gateway.entryPoint, PILOT_ACCOUNT_STACK.entryPoint) &&
      Object.values(deps.policy.limits).every((n) => typeof n === "bigint" && n > 0n)
    );
  const now = () => deps?.now?.() ?? Date.now();
  const status = (intent: SponsorIntent) => ({
    id: intent.id,
    status: intent.status,
    userOperationHash: intent.opHash,
    transactionHash: intent.txHash,
  });
  async function authorize(body: Record<string, unknown>, action: PilotAction) {
    if (!deps) throw new Error("Pilot unavailable");
    const intent = deps.ledger.get(text(body.id, 80));
    if (!(await verifyPilotProof(intent.challenge, action, hex(body.proof))))
      throw new Error("Invalid owner proof");
    return intent;
  }
  async function checkRequest(intent: SponsorIntent) {
    if (!deps) throw new Error("Pilot unavailable");
    const signed = decodeRequestUrl(intent.requestUrl);
    if (
      !(await (deps.verify ?? verifyRequest)(signed)).ok ||
      (await (deps.settled ?? isPaid)(signed.request.merchant, signed.request.nonce))
    )
      throw new Error("Pilot request is not payable");
    if (
      hashRequest(signed.request, signed.chainId) !== intent.requestHash ||
      pilotPaymentCallHash(signed) !== intent.challenge.callDataHash
    )
      throw new Error("Pilot intent changed");
    assertPilotPayment(signed, intent.callData as Hex);
    return signed;
  }
  service.get("/capabilities", (c) =>
    c.json({
      available: ready(),
      chainId: PILOT_ACCOUNT_STACK.chainId,
      accountVersion: PILOT_ACCOUNT_STACK.version,
      entryPointVersion: PILOT_ACCOUNT_STACK.entryPointVersion,
    }),
  );
  service.post("/challenge", async (c) => {
    if (!ready() || !deps?.policy) return c.json({ error: "pilot_unavailable" }, 503);
    try {
      const body = await c.req.json<Record<string, unknown>>();
      if (Object.keys(body).sort().join(",") !== "idempotencyKey,owner,requestUrl")
        throw new Error("Unknown pilot fields");
      const owner = address(body.owner);
      deps.ledger.recordChallengeAttempt(owner, deps.policy, now());
      const idem = text(body.idempotencyKey, 80);
      if (!/^[a-zA-Z0-9_-]{8,80}$/.test(idem)) throw new Error("Invalid idempotency key");
      const signed = decodeRequestUrl(text(body.requestUrl, 4096));
      if (
        !(await (deps.verify ?? verifyRequest)(signed)).ok ||
        signed.request.amount > deps.policy.limits.principalUsdc
      )
        throw new Error("Unverified or excessive request");
      const account = await (deps.deriveAccount ?? getPilotAccount)(owner);
      if (
        !same(owner, account.owner) ||
        same(owner, account.payer) ||
        account.chainId !== PILOT_ACCOUNT_STACK.chainId ||
        account.version !== PILOT_ACCOUNT_STACK.version
      )
        throw new Error("Invalid pilot account");
      await deps.gateway.assertAccount(account);
      const callData = encodePilotPayment(signed);
      const id = crypto.randomUUID();
      const challenge = {
        id,
        audience: deps.policy.audience,
        owner,
        payer: account.payer,
        requestHash: hashRequest(signed.request, signed.chainId),
        callDataHash: pilotPaymentCallHash(signed),
        expiresAt: Math.min(now() + 60_000, Number(signed.request.expiry) * 1000),
      };
      const intent = deps.ledger.create({
        id,
        owner,
        payer: account.payer.toLowerCase(),
        idem,
        requestHash: challenge.requestHash,
        requestUrl: encodeRequestUrl(signed),
        callData,
        challenge,
        status: "created",
        operation: null,
        opHash: null,
        txHash: null,
      });
      return c.json({ challenge: intent.challenge, callData: intent.callData });
    } catch {
      return c.json({ error: "pilot_request_rejected" }, 400);
    }
  });
  service.post("/prepare", async (c) => {
    if (!ready() || !deps?.policy) return c.json({ error: "pilot_unavailable" }, 503);
    try {
      const body = await c.req.json<Record<string, unknown>>();
      if (Object.keys(body).sort().join(",") !== "id,proof")
        throw new Error("Unknown pilot fields");
      const intent = await authorize(body, "prepare");
      if (intent.status !== "created")
        return c.json({
          ...status(intent),
          operation: intent.operation ? pilotOperationWire(intent.operation) : null,
        });
      const signed = await checkRequest(intent);
      const account = await (deps.deriveAccount ?? getPilotAccount)(intent.owner as Address);
      if (!same(account.payer, intent.payer)) throw new Error("Pilot account changed");
      const context = await deps.gateway.assertAccount(account);
      if (!deps.ledger.reserve(intent.id, deps.policy, now()))
        return c.json(status(deps.ledger.get(intent.id)), 202);
      try {
        const operation = await deps.gateway.prepare(account, intent.callData as Hex);
        assertPilotOperation(operation, account, signed, deps.policy.limits, context);
        if (operation.signature !== "0x") throw new Error("Prepared operation must be unsigned");
        deps.ledger.prepared(intent.id, operation);
      } catch {
        deps.ledger.mark(intent.id, "unknown");
      }
      const saved = deps.ledger.get(intent.id);
      return c.json({
        ...status(saved),
        operation: saved.operation ? pilotOperationWire(saved.operation) : null,
      });
    } catch {
      return c.json({ error: "pilot_request_rejected" }, 400);
    }
  });
  service.post("/submit", async (c) => {
    if (!ready() || !deps?.policy) return c.json({ error: "pilot_unavailable" }, 503);
    try {
      const body = await c.req.json<Record<string, unknown>>();
      if (Object.keys(body).sort().join(",") !== "id,proof,signature")
        throw new Error("Unknown pilot fields");
      const intent = await authorize(body, "submit");
      if (intent.status !== "prepared") return c.json(status(intent), 202);
      if (!intent.operation) throw new Error("Pilot operation missing");
      const signed = await checkRequest(intent);
      const account = await (deps.deriveAccount ?? getPilotAccount)(intent.owner as Address);
      const context = await deps.gateway.assertAccount(account);
      const operation = { ...intent.operation, signature: hex(body.signature) };
      assertPilotOperation(operation, account, signed, deps.policy.limits, context);
      if (!(await verifyPilotOperationOwner(intent.owner as Address, operation)))
        throw new Error("Invalid operation owner");
      const hash = pilotOperationHash(operation);
      if (!deps.ledger.claimSubmission(intent.id, hash))
        return c.json(status(deps.ledger.get(intent.id)), 202);
      try {
        const returned = await deps.gateway.send(operation);
        deps.ledger.mark(intent.id, returned === hash ? "pending" : "unknown");
      } catch {
        deps.ledger.mark(intent.id, "unknown");
      }
      return c.json(status(deps.ledger.get(intent.id)), 202);
    } catch {
      return c.json({ error: "pilot_request_rejected" }, 400);
    }
  });
  service.post("/status", async (c) => {
    // Existing liabilities remain inspectable after payment enablement/budgets are disabled.
    if (!deps) return c.json({ error: "pilot_unavailable" }, 503);
    try {
      const body = await c.req.json<Record<string, unknown>>();
      if (Object.keys(body).sort().join(",") !== "id,proof")
        throw new Error("Unknown pilot fields");
      const intent = await authorize(body, "status");
      if (
        intent.opHash &&
        intent.operation &&
        intent.status !== "paid" &&
        intent.status !== "reverted"
      ) {
        try {
          const located = await deps.gateway.locate(intent.opHash as Hash);
          if (
            !located ||
            located.userOpHash !== intent.opHash ||
            !same(located.sender, intent.payer) ||
            located.nonce !== intent.operation.nonce
          )
            deps.ledger.mark(intent.id, "unknown");
          else {
            const receipt = await deps.gateway.canonicalReceipt(located.transactionHash);
            if (receipt.transactionHash !== located.transactionHash)
              throw new Error("Receipt mismatch");
            deps.ledger.mark(
              intent.id,
              reconcilePilotReceipt(intent.operation, decodeRequestUrl(intent.requestUrl), receipt),
              receipt.transactionHash,
            );
          }
        } catch {
          deps.ledger.mark(intent.id, "unknown");
        }
      }
      return c.json(status(deps.ledger.get(intent.id)));
    } catch {
      return c.json({ error: "pilot_request_rejected" }, 400);
    }
  });
  service.all("*", (c) => c.json({ error: "pilot_route_not_found" }, 404));
  return service;
}
