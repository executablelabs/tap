import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import {
  configureTap,
  encodePilotPayment,
  generatePrivateKey,
  getPaymentChain,
  getPilotAccount,
  type Hash,
  PILOT_ACCOUNT_STACK,
  type PilotChallenge,
  type PilotOperation,
  type PilotOperationWire,
  type PilotReceipt,
  parsePilotOperation,
  pilotOperationHash,
  pilotOperationWire,
  pilotProofMessage,
  privateKeyToAccount,
  signPilotOperation,
} from "@tap/core";
import { createFakeCore, fakeMerchantAccount } from "@tap/core/testing";
import {
  createPublicClient,
  custom,
  encodeAbiParameters,
  encodeEventTopics,
  type Hex,
  type PublicClient,
  parseAbi,
} from "viem";
import { baseSepolia } from "viem/chains";
import { hasUnresolvedPilot } from "../../mobile/src/sponsorship/pending";
import {
  createPilotPaymentSession,
  type PilotRemote,
  type PilotRemoteStatus,
} from "../../mobile/src/sponsorship/session";
import { app } from "../src/app";
import { SponsorLedger } from "../src/sponsor/ledger";
import type { SponsorPolicy } from "../src/sponsor/policy";
import {
  createSponsorService,
  type SponsorDependencies,
  type SponsorGateway,
} from "../src/sponsor/service";

afterEach(() => configureTap());
async function fixture() {
  const owner = privateKeyToAccount(generatePrivateKey());
  const payer = "0x0000000000000000000000000000000000001234";
  const paymaster = "0x0000000000000000000000000000000000005678";
  configureTap({
    paymentClient: createPublicClient({
      chain: baseSepolia,
      transport: custom({
        async request({ method }) {
          if (method !== "eth_call") throw new Error("Unexpected RPC");
          return encodeAbiParameters([{ type: "address" }], [payer]);
        },
      }),
    }) as PublicClient,
  });
  const account = await getPilotAccount(owner.address);
  const core = createFakeCore();
  const signed = await core.signRequest(
    core.newChargeRequest({
      merchant: fakeMerchantAccount.address,
      merchantName: "stall.tap.eth",
      amount: 5_000_000n,
    }),
    fakeMerchantAccount,
  );
  const url = core.encodeRequestUrl(signed);
  const ledger = new SponsorLedger(new Database(":memory:"));
  const policy: SponsorPolicy = {
    audience: "https://tap-pay.xyz",
    ownerChallengesDaily: 20,
    globalChallengesDaily: 40,
    limits: {
      operationWei: 1_000_000n,
      ownerDailyWei: 2_000_000n,
      globalDailyWei: 3_000_000n,
      principalUsdc: 10_000_000n,
      callGas: 100_000n,
      verificationGas: 100_000n,
      preVerificationGas: 100_000n,
      feePerGas: 1n,
    },
  };
  let prepares = 0;
  let sends = 0;
  let valid = true;
  let badCalls = false;
  let sendThrows = false;
  let storedOp: PilotOperation | undefined;
  let included = false;
  let clock = Date.now();
  const tx = `0x${"ab".repeat(32)}` as Hash;
  const gateway: SponsorGateway = {
    chainId: 84532,
    entryPoint: PILOT_ACCOUNT_STACK.entryPoint,
    assertAccount: async () => ({ deployed: false, paymaster }),
    async prepare(_account, callData) {
      prepares++;
      return {
        sender: payer,
        nonce: 0n,
        initCode: account.initCode,
        callData: badCalls ? `${callData}00` : callData,
        callGasLimit: 50_000n,
        verificationGasLimit: 50_000n,
        preVerificationGas: 20_000n,
        maxFeePerGas: 1n,
        maxPriorityFeePerGas: 1n,
        paymasterAndData: paymaster,
        signature: "0x",
      };
    },
    async send(operation) {
      sends++;
      storedOp = operation;
      if (sendThrows) throw new Error("PRIVATE PROVIDER ENDPOINT MUST NOT LEAK");
      return pilotOperationHash(operation);
    },
    async locate(hash) {
      return included && storedOp
        ? { userOpHash: hash, transactionHash: tx, sender: payer, nonce: storedOp.nonce }
        : null;
    },
    async canonicalReceipt() {
      if (!storedOp) throw new Error("Missing submission");
      const chain = getPaymentChain(84532);
      if (!chain) throw new Error("Missing chain");
      const paidAbi = parseAbi([
        "event Paid(address indexed merchant, bytes32 indexed nonce, address indexed payer, address token, uint256 amount)",
      ]);
      const opAbi = parseAbi([
        "event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)",
      ]);
      return {
        status: "success",
        transactionHash: tx,
        logs: [
          {
            address: chain.tapPay,
            topics: encodeEventTopics({
              abi: paidAbi,
              eventName: "Paid",
              args: { merchant: signed.request.merchant, nonce: signed.request.nonce, payer },
            }) as [Hex, ...Hex[]],
            data: encodeAbiParameters(
              [{ type: "address" }, { type: "uint256" }],
              [signed.request.token, signed.request.amount],
            ),
          },
          {
            address: PILOT_ACCOUNT_STACK.entryPoint,
            topics: encodeEventTopics({
              abi: opAbi,
              eventName: "UserOperationEvent",
              args: { userOpHash: pilotOperationHash(storedOp), sender: payer, paymaster },
            }) as [Hex, ...Hex[]],
            data: encodeAbiParameters(
              [{ type: "uint256" }, { type: "bool" }, { type: "uint256" }, { type: "uint256" }],
              [storedOp.nonce, true, 1n, 1n],
            ),
          },
        ],
      } satisfies PilotReceipt;
    },
  };
  const deps: SponsorDependencies = {
    enabled: true,
    readiness: {
      accountCode: true,
      providerBinding: true,
      persistentHost: true,
      rescue: true,
      device: true,
    },
    policy,
    ledger,
    gateway,
    deriveAccount: async (root) => ({ ...account, owner: root }),
    verify: async () =>
      valid
        ? {
            ok: true,
            ensName: "stall.tap.eth",
            displayName: null,
            tokenSymbol: "USDC",
            displayAmount: "$5.00",
            expiresAt: new Date(Number(signed.request.expiry) * 1000),
          }
        : { ok: false, reason: "network_error" },
    settled: async () => false,
    now: () => clock,
  };
  const service = createSponsorService(deps);
  const post = (path: string, body: unknown) =>
    service.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  async function challenge() {
    const response = await post("/challenge", {
      owner: owner.address,
      requestUrl: url,
      idempotencyKey: "payment_0001",
    });
    expect(response.status).toBe(200);
    return ((await response.json()) as { challenge: PilotChallenge }).challenge;
  }
  const proof = (challenge: PilotChallenge, action: "prepare" | "submit" | "status") =>
    owner.signMessage({ message: pilotProofMessage(challenge, action) });
  return {
    owner,
    url,
    account,
    signed,
    policy,
    deps,
    ledger,
    gateway,
    service,
    post,
    challenge,
    proof,
    prepares: () => prepares,
    sends: () => sends,
    sentSignature: () => storedOp?.signature,
    valid: (value: boolean) => {
      valid = value;
    },
    badCalls: () => {
      badCalls = true;
    },
    sendThrows: () => {
      sendThrows = true;
    },
    include: () => {
      included = true;
    },
    advance: () => {
      clock += 60_001;
    },
  };
}

test("public pilot is unavailable and cannot be enabled by request fields or arbitrary RPC", async () => {
  const caps = await app.request("/api/sponsor/capabilities");
  expect(await caps.json()).toMatchObject({
    available: false,
    chainId: 84532,
    entryPointVersion: "0.6",
  });
  expect(
    (await app.request("/api/sponsor/prepare", { method: "POST", body: '{"enabled":true}' }))
      .status,
  ).toBe(503);
  expect((await app.request("/api/sponsor/eth_sendUserOperation", { method: "POST" })).status).toBe(
    404,
  );
});

function mobileRemote(f: Awaited<ReturnType<typeof fixture>>): PilotRemote {
  async function post<T>(path: string, body: unknown): Promise<T> {
    const response = await f.post(path, body);
    if (!response.ok) throw new Error("Pilot remote rejected request");
    return (await response.json()) as T;
  }
  return {
    available: async () =>
      ((await (await f.service.request("/capabilities")).json()) as { available: boolean })
        .available,
    challenge: (body) => post("/challenge", body),
    prepare: (body) => post("/prepare", body),
    submit: (body) => post("/submit", body),
    status: (body) => post<PilotRemoteStatus>("/status", body),
  };
}

test("mobile-to-Hono offline slice requires opt-in, persists before submission, and resumes after expiry without retry", async () => {
  const f = await fixture();
  const saved = new Map<string, string>();
  const storage = {
    getItemAsync: async (key: string) => saved.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => {
      saved.set(key, value);
    },
  };
  const options = {
    owner: f.owner,
    account: f.account,
    consent: f.account,
    audience: f.policy.audience,
    limits: f.policy.limits,
    context: { deployed: false, paymaster: "0x0000000000000000000000000000000000005678" as const },
    remote: mobileRemote(f),
    storage,
    verify: f.deps.verify,
    receipt: f.gateway.canonicalReceipt,
  };
  try {
    const declined = createPilotPaymentSession({ ...options, consent: null });
    expect(await declined.confirm(f.url)).toBe("unavailable");
    expect(f.prepares()).toBe(0);
    const session = createPilotPaymentSession(options);
    const competing = createPilotPaymentSession(options);
    await competing.load();
    await Promise.all([session.confirm(f.url), competing.confirm(f.url)]);
    expect(f.sends()).toBe(1);
    expect(session.getState()).toBe("unknown");
    expect(await competing.confirm(f.url)).toBe("unknown");
    expect(f.sends()).toBe(1);
    expect(await hasUnresolvedPilot(storage, f.owner.address)).toBe(true);
    expect(await session.dismissResolved()).toBe(false);
    const signature = f.sentSignature();
    if (!signature) throw new Error("Missing owner signature");
    expect([...saved.values()].join("\n")).not.toContain(signature);
    configureTap({ now: () => new Date(Number(f.signed.request.expiry + 1n) * 1000) });
    const reopened = createPilotPaymentSession(options);
    await reopened.load();
    expect(await reopened.confirm(f.url)).toBe("unknown");
    expect(f.sends()).toBe(1);
    f.include();
    f.deps.enabled = false;
    f.deps.policy = null;
    expect(await reopened.checkPending()).toBe("paid");
    expect(await reopened.dismissResolved()).toBe(true);
    expect(await hasUnresolvedPilot(storage, f.owner.address)).toBe(false);
    expect(f.sends()).toBe(1);
  } finally {
    f.ledger.close();
  }
});

test("mobile storage failure or corrupt journal cannot authorize or replace a payment", async () => {
  const f = await fixture();
  const options = {
    owner: f.owner,
    account: f.account,
    consent: f.account,
    audience: f.policy.audience,
    limits: f.policy.limits,
    context: { deployed: false, paymaster: "0x0000000000000000000000000000000000005678" as const },
    remote: mobileRemote(f),
    verify: f.deps.verify,
  };
  try {
    const failed = createPilotPaymentSession({
      ...options,
      storage: {
        getItemAsync: async () => null,
        setItemAsync: async () => {
          throw new Error("locked");
        },
      },
    });
    expect(await failed.confirm(f.url)).toBe("unknown");
    expect(f.prepares()).toBe(0);
    for (const raw of ["{", ""]) {
      const corrupt = createPilotPaymentSession({
        ...options,
        storage: { getItemAsync: async () => raw, setItemAsync: async () => {} },
      });
      expect(await corrupt.confirm(f.url)).toBe("unknown");
      expect(await corrupt.dismissResolved()).toBe(false);
    }
    expect(f.prepares()).toBe(0);
    expect(f.sends()).toBe(0);
  } finally {
    f.ledger.close();
  }
});

test("a stale resolved controller cannot dismiss a newer pending intent", async () => {
  const f = await fixture();
  const saved = new Map<string, string>();
  const storage = {
    getItemAsync: async (key: string) => saved.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => {
      saved.set(key, value);
    },
  };
  try {
    f.include();
    const session = createPilotPaymentSession({
      owner: f.owner,
      account: f.account,
      consent: f.account,
      audience: f.policy.audience,
      limits: f.policy.limits,
      context: { deployed: false, paymaster: "0x0000000000000000000000000000000000005678" },
      remote: mobileRemote(f),
      storage,
      verify: f.deps.verify,
      receipt: f.gateway.canonicalReceipt,
    });
    expect(await session.confirm(f.url)).toBe("paid");
    const entry = [...saved.entries()][0];
    if (!entry) throw new Error("Missing journal");
    const replacement = JSON.parse(entry[1]) as { challenge: { id: string }; status: string };
    replacement.challenge.id = "a-newer-intent";
    replacement.status = "unknown";
    saved.set(entry[0], JSON.stringify(replacement));
    expect(await session.dismissResolved()).toBe(false);
    expect(saved.get(entry[0])).toContain("a-newer-intent");
  } finally {
    f.ledger.close();
  }
});

test("a journal with mismatched request/execution cannot reach remote reconciliation", async () => {
  const f = await fixture();
  const saved = new Map<string, string>();
  const storage = {
    getItemAsync: async (key: string) => saved.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => {
      saved.set(key, value);
    },
  };
  const remote = mobileRemote(f);
  const options = {
    owner: f.owner,
    account: f.account,
    consent: f.account,
    audience: f.policy.audience,
    limits: f.policy.limits,
    context: { deployed: false, paymaster: "0x0000000000000000000000000000000000005678" as const },
    remote,
    storage,
    verify: f.deps.verify,
    receipt: f.gateway.canonicalReceipt,
  };
  try {
    await createPilotPaymentSession(options).confirm(f.url);
    const entry = [...saved.entries()][0];
    if (!entry) throw new Error("Missing journal");
    const record = JSON.parse(entry[1]) as {
      operation: PilotOperationWire;
      userOperationHash: Hash;
    };
    const op = parsePilotOperation(record.operation);
    op.callData = encodePilotPayment({
      ...f.signed,
      request: { ...f.signed.request, amount: f.signed.request.amount + 1n },
    });
    record.operation = pilotOperationWire(op);
    record.userOperationHash = pilotOperationHash(op);
    saved.set(entry[0], JSON.stringify(record));
    let reads = 0;
    remote.status = async () => {
      reads++;
      throw new Error("Untrusted journal must not leave device");
    };
    const restarted = createPilotPaymentSession(options);
    expect(await restarted.checkPending()).toBe("unknown");
    expect(reads).toBe(0);
    expect(await restarted.dismissResolved()).toBe(false);
  } finally {
    f.ledger.close();
  }
});

test("authenticated prepare is replay-safe and rechecks ENS before reserving provider authorization", async () => {
  const f = await fixture();
  try {
    const ch = await f.challenge();
    const wrong = await fakeMerchantAccount.signMessage({
      message: pilotProofMessage(ch, "prepare"),
    });
    expect((await f.post("/prepare", { id: ch.id, proof: wrong })).status).toBe(400);
    expect(
      (await f.post("/prepare", { id: ch.id, proof: await f.proof(ch, "prepare"), callData: "0x" }))
        .status,
    ).toBe(400);
    expect(f.prepares()).toBe(0);
    const proof = await f.proof(ch, "prepare");
    f.valid(false);
    expect((await f.post("/prepare", { id: ch.id, proof })).status).toBe(400);
    f.valid(true);
    const responses = await Promise.all([
      f.post("/prepare", { id: ch.id, proof }),
      f.post("/prepare", { id: ch.id, proof }),
    ]);
    expect(responses.every((response) => response.status < 300)).toBe(true);
    expect(f.prepares()).toBe(1);
    await f.post("/prepare", { id: ch.id, proof });
    expect(f.prepares()).toBe(1);
    expect(f.ledger.get(ch.id).status).toBe("prepared");
  } finally {
    f.ledger.close();
  }
});

test("malformed provider execution remains unknown with reservation retained", async () => {
  const f = await fixture();
  try {
    const ch = await f.challenge();
    f.badCalls();
    const response = await f.post("/prepare", { id: ch.id, proof: await f.proof(ch, "prepare") });
    expect(await response.json()).toMatchObject({ status: "unknown", operation: null });
    expect(f.ledger.reserve(ch.id, f.policy, Date.now())).toBe(false);
    expect(f.sends()).toBe(0);
  } finally {
    f.ledger.close();
  }
});

test("expired, unconfigured and unverified stacks never call the provider", async () => {
  const f = await fixture();
  try {
    const ch = await f.challenge();
    f.advance();
    expect(
      (await f.post("/prepare", { id: ch.id, proof: await f.proof(ch, "prepare") })).status,
    ).toBe(400);
    f.deps.policy = null;
    expect(
      (await f.post("/prepare", { id: ch.id, proof: await f.proof(ch, "prepare") })).status,
    ).toBe(503);
    f.deps.policy = f.policy;
    const { operationWei: _omitted, ...incomplete } = f.policy.limits;
    f.deps.policy = { ...f.policy, limits: incomplete as typeof f.policy.limits };
    expect(await (await f.service.request("/capabilities")).json()).toMatchObject({
      available: false,
    });
    f.deps.policy = f.policy;
    f.deps.policy = { ...f.policy, ownerChallengesDaily: undefined } as unknown as SponsorPolicy;
    expect(await (await f.service.request("/capabilities")).json()).toMatchObject({
      available: false,
    });
    f.deps.policy = f.policy;
    f.deps.readiness.providerBinding = false;
    expect((await f.service.request("/capabilities")).status).toBe(200);
    expect(await (await f.service.request("/capabilities")).json()).toMatchObject({
      available: false,
    });
    expect(f.prepares()).toBe(0);
  } finally {
    f.ledger.close();
  }
});

test("ambiguous send is never repeated; status reconciles canonical evidence even after payment disablement", async () => {
  const f = await fixture();
  try {
    const ch = await f.challenge();
    await f.post("/prepare", { id: ch.id, proof: await f.proof(ch, "prepare") });
    const op = f.ledger.get(ch.id).operation;
    if (!op) throw new Error("Missing prepared operation");
    const signature = await signPilotOperation(f.owner, f.account, op, f.signed, f.policy.limits, {
      deployed: false,
      paymaster: op.paymasterAndData.slice(0, 42) as `0x${string}`,
    });
    f.sendThrows();
    const body = { id: ch.id, proof: await f.proof(ch, "submit"), signature };
    expect(await (await f.post("/submit", body)).json()).toMatchObject({
      status: "unknown",
      userOperationHash: pilotOperationHash(op),
    });
    expect(JSON.stringify(pilotOperationWire(f.ledger.get(ch.id).operation ?? op))).not.toContain(
      signature,
    );
    await f.post("/submit", body);
    expect(f.sends()).toBe(1);
    f.deps.enabled = false;
    f.deps.policy = null;
    const statusBody = { id: ch.id, proof: await f.proof(ch, "status") };
    expect(await (await f.post("/status", statusBody)).json()).toMatchObject({ status: "unknown" });
    f.include();
    expect(await (await f.post("/status", statusBody)).json()).toMatchObject({ status: "paid" });
    f.ledger.mark(ch.id, "unknown");
    expect(f.ledger.get(ch.id).status).toBe("paid");
    expect(f.sends()).toBe(1);
  } finally {
    f.ledger.close();
  }
});
