import { Database } from "bun:sqlite";
import {
  type PilotChallenge,
  type PilotOperation,
  type PilotStatus,
  parsePilotOperation,
  pilotOperationWire,
} from "@tap/core";
import { type SponsorPolicy, sponsorPolicyConfigured } from "./policy";

export type SponsorIntent = {
  id: string;
  owner: string;
  payer: string;
  idem: string;
  requestHash: string;
  requestUrl: string;
  callData: string;
  challenge: PilotChallenge;
  status: PilotStatus;
  operation: PilotOperation | null;
  opHash: string | null;
  txHash: string | null;
};
type Row = Omit<SponsorIntent, "challenge" | "operation"> & {
  challenge: string;
  operation: string | null;
};

function decode(row: Row): SponsorIntent {
  return {
    ...row,
    challenge: JSON.parse(row.challenge) as PilotChallenge,
    operation: row.operation ? parsePilotOperation(JSON.parse(row.operation)) : null,
  };
}
const dayOf = (now: number) => Math.floor(now / 86_400_000);

export class SponsorLedger {
  constructor(private readonly db: Database) {
    db.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
    db.exec("CREATE TABLE IF NOT EXISTS pilot_meta (version INTEGER NOT NULL)");
    const version = db.query<{ version: number }, []>("SELECT version FROM pilot_meta").get();
    if (version && version.version !== 2) throw new Error("Unsupported pilot ledger version");
    if (!version) db.exec("INSERT INTO pilot_meta VALUES (2)");
    db.exec(`CREATE TABLE IF NOT EXISTS pilot_intents (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL, payer TEXT NOT NULL, idem TEXT NOT NULL,
      requestHash TEXT NOT NULL, requestUrl TEXT NOT NULL, callData TEXT NOT NULL,
      challenge TEXT NOT NULL, status TEXT NOT NULL, operation TEXT, opHash TEXT, txHash TEXT,
      reservedWei TEXT, reservedDay INTEGER, UNIQUE(owner, idem)
    ); CREATE UNIQUE INDEX IF NOT EXISTS pilot_request_claim ON pilot_intents(payer,requestHash) WHERE status<>'created';
    CREATE TABLE IF NOT EXISTS pilot_attempts (owner TEXT NOT NULL, day INTEGER NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(owner,day));`);
  }

  static open(path: string): SponsorLedger {
    if (!path.startsWith("/") || path.includes(":memory:"))
      throw new Error("A persistent absolute pilot database path is required");
    return new SponsorLedger(new Database(path, { create: true, strict: true }));
  }
  close() {
    this.db.close();
  }
  get(id: string): SponsorIntent {
    const row = this.db.query<Row, [string]>("SELECT * FROM pilot_intents WHERE id=?").get(id);
    if (!row) throw new Error("Unknown pilot intent");
    return decode(row);
  }

  recordChallengeAttempt(owner: string, policy: SponsorPolicy, now: number): void {
    if (!sponsorPolicyConfigured(policy)) throw new Error("Pilot budgets are not configured");
    this.db
      .transaction(() => {
        const day = dayOf(now);
        const own =
          this.db
            .query<{ count: number }, [string, number]>(
              "SELECT count FROM pilot_attempts WHERE owner=? AND day=?",
            )
            .get(owner, day)?.count ?? 0;
        const all =
          this.db
            .query<{ count: number }, [number]>(
              "SELECT COALESCE(SUM(count),0) AS count FROM pilot_attempts WHERE day=?",
            )
            .get(day)?.count ?? 0;
        if (own >= policy.ownerChallengesDaily || all >= policy.globalChallengesDaily)
          throw new Error("Pilot challenge quota exceeded");
        this.db
          .query(
            "INSERT INTO pilot_attempts VALUES (?,?,1) ON CONFLICT(owner,day) DO UPDATE SET count=count+1",
          )
          .run(owner, day);
      })
      .immediate();
  }

  create(intent: SponsorIntent): SponsorIntent {
    return this.db
      .transaction(() => {
        const prior = this.db
          .query<Row, [string, string]>("SELECT * FROM pilot_intents WHERE owner=? AND idem=?")
          .get(intent.owner, intent.idem);
        if (prior) {
          if (
            prior.owner !== intent.owner ||
            prior.idem !== intent.idem ||
            prior.requestUrl !== intent.requestUrl ||
            prior.callData !== intent.callData
          )
            throw new Error("Pilot idempotency conflict");
          return decode(prior);
        }
        this.db
          .query(
            "INSERT INTO pilot_intents(id,owner,payer,idem,requestHash,requestUrl,callData,challenge,status) VALUES(?,?,?,?,?,?,?,?,?)",
          )
          .run(
            intent.id,
            intent.owner,
            intent.payer,
            intent.idem,
            intent.requestHash,
            intent.requestUrl,
            intent.callData,
            JSON.stringify(intent.challenge),
            "created",
          );
        return this.get(intent.id);
      })
      .immediate();
  }

  reserve(id: string, policy: SponsorPolicy, now: number): boolean {
    if (!sponsorPolicyConfigured(policy)) throw new Error("Pilot budgets are not configured");
    return this.db
      .transaction(() => {
        const intent = this.get(id);
        if (intent.status !== "created") return false;
        if (now >= intent.challenge.expiresAt) throw new Error("Pilot challenge expired");
        const active = this.db
          .query<{ id: string }, [string, string]>(
            "SELECT id FROM pilot_intents WHERE payer=? AND id<>? AND status IN ('preparing','prepared','submitting','pending','unknown') LIMIT 1",
          )
          .get(intent.payer, id);
        if (active) throw new Error("Another pilot operation is unresolved");
        const liabilities = this.db
          .query<{ owner: string; reservedWei: string }, [number]>(
            "SELECT owner,reservedWei FROM pilot_intents WHERE reservedWei IS NOT NULL AND (reservedDay>=? OR status NOT IN ('paid','reverted'))",
          )
          .all(dayOf(now));
        const total = liabilities.reduce((sum, row) => sum + BigInt(row.reservedWei), 0n);
        const owner = liabilities
          .filter((row) => row.owner === intent.owner)
          .reduce((sum, row) => sum + BigInt(row.reservedWei), 0n);
        const cap = policy.limits.operationWei;
        if (
          cap <= 0n ||
          owner + cap > policy.limits.ownerDailyWei ||
          total + cap > policy.limits.globalDailyWei
        )
          throw new Error("Pilot budget exhausted");
        this.db
          .query(
            "UPDATE pilot_intents SET status='preparing',reservedWei=?,reservedDay=? WHERE id=?",
          )
          .run(cap.toString(), dayOf(now), id);
        return true;
      })
      .immediate();
  }

  prepared(id: string, operation: PilotOperation): void {
    if (operation.signature !== "0x") throw new Error("Never persist an owner operation signature");
    const changed = this.db
      .query(
        "UPDATE pilot_intents SET status='prepared',operation=? WHERE id=? AND status='preparing'",
      )
      .run(JSON.stringify(pilotOperationWire(operation)), id);
    if (changed.changes !== 1) throw new Error("Pilot preparation is no longer active");
  }

  claimSubmission(id: string, opHash: string): boolean {
    return (
      this.db
        .query(
          "UPDATE pilot_intents SET status='submitting',opHash=? WHERE id=? AND status='prepared'",
        )
        .run(opHash, id).changes === 1
    );
  }

  mark(
    id: string,
    status: "pending" | "unknown" | "paid" | "reverted",
    txHash: string | null = null,
  ): void {
    // Final evidence is monotonic; a concurrent stale status poll cannot erase it.
    this.db
      .query(
        "UPDATE pilot_intents SET status=?,txHash=COALESCE(?,txHash) WHERE id=? AND status NOT IN ('created','paid','reverted') AND (? NOT IN ('paid','reverted') OR opHash IS NOT NULL)",
      )
      .run(status, txHash, id, status);
  }
}
