import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import type { PilotChallenge } from "@tap/core";
import { type SponsorIntent, SponsorLedger } from "../src/sponsor/ledger";
import { parseSponsorPolicy, type SponsorPolicy } from "../src/sponsor/policy";

export const testPolicy: SponsorPolicy = {
  audience: "https://tap-pay.xyz",
  ownerChallengesDaily: 10,
  globalChallengesDaily: 20,
  limits: {
    operationWei: 10n,
    ownerDailyWei: 20n,
    globalDailyWei: 30n,
    principalUsdc: 5_000_000n,
    callGas: 100n,
    verificationGas: 100n,
    preVerificationGas: 100n,
    feePerGas: 1n,
  },
};
export function testIntent(id: string, owner = "owner", requestHash = id): SponsorIntent {
  return {
    id,
    owner,
    payer: `${owner}-${requestHash}`,
    idem: id,
    requestHash,
    requestUrl: id,
    callData: "0x",
    challenge: { id, expiresAt: 1_000_000 } as PilotChallenge,
    status: "created",
    operation: null,
    opHash: null,
    txHash: null,
  };
}

test("missing, zero and malformed budgets deny configuration", () => {
  expect(parseSponsorPolicy({})).toBeNull();
  const values = {
    SPONSOR_AUDIENCE: "https://tap-pay.xyz",
    SPONSOR_OPERATION_WEI: "1",
    SPONSOR_OWNER_DAILY_WEI: "2",
    SPONSOR_GLOBAL_DAILY_WEI: "3",
    SPONSOR_PRINCIPAL_USDC: "1",
    SPONSOR_CALL_GAS: "1",
    SPONSOR_VERIFICATION_GAS: "1",
    SPONSOR_PRE_VERIFICATION_GAS: "1",
    SPONSOR_FEE_PER_GAS: "1",
    SPONSOR_OWNER_CHALLENGES_DAILY: "1",
    SPONSOR_GLOBAL_CHALLENGES_DAILY: "2",
  };
  expect(parseSponsorPolicy(values)).not.toBeNull();
  for (const value of [undefined, "0", "-1", "1e3", "01", "1.5"])
    expect(parseSponsorPolicy({ ...values, SPONSOR_OPERATION_WEI: value })).toBeNull();
  expect(parseSponsorPolicy({ ...values, SPONSOR_AUDIENCE: "http://tap-pay.xyz" })).toBeNull();
});

test("an earlier ledger schema is rejected without deleting its data", () => {
  const db = new Database(":memory:");
  try {
    db.exec("CREATE TABLE pilot_meta(version INTEGER); INSERT INTO pilot_meta VALUES (1)");
    expect(() => new SponsorLedger(db)).toThrow("version");
    expect(db.query<{ version: number }, []>("SELECT version FROM pilot_meta").get()?.version).toBe(
      1,
    );
  } finally {
    db.close();
  }
});

test("reservations are atomic, idempotent and carry unresolved liability across day boundaries", async () => {
  const ledger = new SponsorLedger(new Database(":memory:"));
  try {
    for (const id of ["a", "b", "c"]) ledger.create(testIntent(id));
    expect(() =>
      ledger.reserve("a", { ...testPolicy, limits: { operationWei: 10n } } as SponsorPolicy, 0),
    ).toThrow("configured");
    const attempts = await Promise.allSettled(
      ["a", "b", "c"].map(async (id) => ledger.reserve(id, testPolicy, 0)),
    );
    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    expect(ledger.reserve("a", testPolicy, 0)).toBe(false);
    expect(() => ledger.create({ ...testIntent("a"), requestUrl: "changed" })).toThrow();
    ledger.create(testIntent("new-key", "owner", "a"));
    expect(() => ledger.reserve("new-key", testPolicy, 0)).toThrow();
    ledger.create({
      ...testIntent("d"),
      challenge: { ...testIntent("d").challenge, expiresAt: 100_000_000 },
    });
    expect(() => ledger.reserve("d", testPolicy, 86_400_000)).toThrow("budget");
  } finally {
    ledger.close();
  }
});

test("two connections share durable reservations; reopen does not release ambiguous work", () => {
  const file = `${import.meta.dir}/../../../node_modules/pilot-ledger-${crypto.randomUUID()}.sqlite`;
  let first: SponsorLedger | undefined;
  let second: SponsorLedger | undefined;
  try {
    first = SponsorLedger.open(file);
    second = SponsorLedger.open(file);
    first.create(testIntent("a"));
    first.create(testIntent("b"));
    first.create(testIntent("c"));
    first.reserve("a", testPolicy, 0);
    second.reserve("b", testPolicy, 0);
    expect(() => second?.reserve("c", testPolicy, 0)).toThrow("budget");
    first.close();
    first = undefined;
    second.close();
    second = undefined;
    first = SponsorLedger.open(file);
    expect(first.get("a").status).toBe("preparing");
    expect(() => first?.reserve("c", testPolicy, 0)).toThrow("budget");
  } finally {
    first?.close();
    second?.close();
    for (const path of [file, `${file}-wal`, `${file}-shm`]) {
      try {
        unlinkSync(path);
      } catch {
        /* SQLite may remove WAL files on close. */
      }
    }
  }
});

test("an unresolved payer blocks a different request and challenge quotas count invalid attempts", () => {
  const ledger = new SponsorLedger(new Database(":memory:"));
  try {
    const first = ledger.create(testIntent("a"));
    ledger.create({ ...testIntent("b"), payer: first.payer });
    ledger.reserve("a", testPolicy, 0);
    expect(() => ledger.reserve("b", testPolicy, 0)).toThrow("unresolved");
    ledger.mark("a", "unknown");
    expect(() => ledger.reserve("b", testPolicy, 0)).toThrow("unresolved");
    ledger.mark("a", "paid");
    expect(ledger.get("a").status).toBe("unknown");
    for (let i = 0; i < testPolicy.ownerChallengesDaily; i++)
      ledger.recordChallengeAttempt("owner", testPolicy, 0);
    expect(() => ledger.recordChallengeAttempt("owner", testPolicy, 0)).toThrow("quota");
  } finally {
    ledger.close();
  }
});
