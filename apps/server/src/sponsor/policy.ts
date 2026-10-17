import type { PilotLimits } from "@tap/core";

export type SponsorPolicy = {
  limits: PilotLimits;
  ownerChallengesDaily: number;
  globalChallengesDaily: number;
  audience: string;
};

export function sponsorPolicyConfigured(policy: SponsorPolicy | null): boolean {
  const fields = [
    "operationWei",
    "ownerDailyWei",
    "globalDailyWei",
    "principalUsdc",
    "callGas",
    "verificationGas",
    "preVerificationGas",
    "feePerGas",
  ] as const;
  try {
    return (
      !!policy?.limits &&
      fields.every(
        (field) =>
          typeof policy.limits[field] === "bigint" &&
          policy.limits[field] > 0n &&
          policy.limits[field] < 1n << 256n,
      ) &&
      policy.limits.operationWei <= policy.limits.ownerDailyWei &&
      policy.limits.ownerDailyWei <= policy.limits.globalDailyWei &&
      Number.isSafeInteger(policy.ownerChallengesDaily) &&
      policy.ownerChallengesDaily > 0 &&
      Number.isSafeInteger(policy.globalChallengesDaily) &&
      policy.globalChallengesDaily > 0 &&
      typeof policy.audience === "string" &&
      policy.audience.startsWith("https://") &&
      new URL(policy.audience).origin === policy.audience
    );
  } catch {
    return false;
  }
}

// Pure parser: importing the public server never reads secrets or opens a database.
// No missing/zero/malformed spending or abuse-control value gets a permissive default.
export function parseSponsorPolicy(
  values: Record<string, string | undefined>,
): SponsorPolicy | null {
  try {
    const positive = (key: string) => {
      const raw = values[key];
      if (!raw || !/^[1-9][0-9]{0,77}$/.test(raw)) throw new Error("Missing pilot limit");
      const n = BigInt(raw);
      if (n >= 1n << 256n) throw new Error("Pilot limit overflow");
      return n;
    };
    const count = (key: string) => {
      const n = positive(key);
      if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Pilot count overflow");
      return Number(n);
    };
    const audience = values.SPONSOR_AUDIENCE;
    if (!audience || new URL(audience).origin !== audience || !audience.startsWith("https://"))
      return null;
    const limits: PilotLimits = {
      operationWei: positive("SPONSOR_OPERATION_WEI"),
      ownerDailyWei: positive("SPONSOR_OWNER_DAILY_WEI"),
      globalDailyWei: positive("SPONSOR_GLOBAL_DAILY_WEI"),
      principalUsdc: positive("SPONSOR_PRINCIPAL_USDC"),
      callGas: positive("SPONSOR_CALL_GAS"),
      verificationGas: positive("SPONSOR_VERIFICATION_GAS"),
      preVerificationGas: positive("SPONSOR_PRE_VERIFICATION_GAS"),
      feePerGas: positive("SPONSOR_FEE_PER_GAS"),
    };
    if (limits.operationWei > limits.ownerDailyWei || limits.ownerDailyWei > limits.globalDailyWei)
      return null;
    return {
      limits,
      ownerChallengesDaily: count("SPONSOR_OWNER_CHALLENGES_DAILY"),
      globalChallengesDaily: count("SPONSOR_GLOBAL_CHALLENGES_DAILY"),
      audience,
    };
  } catch {
    return null;
  }
}
