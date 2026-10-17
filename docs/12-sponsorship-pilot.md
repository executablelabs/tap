# 12 · Disabled sponsorship pilot

D36–D38 record bounded **user** implementation approval, not teammate consensus or
approval of spending/provider/recovery settings. The candidate is pinned viem
2.56.9, Coinbase Smart Wallet 1.1, factory nonce zero and EntryPoint 0.6 on Base
Sepolia. It owns separate balances; the original EOA remains merchant signer and
registrar owner. No funds move when deriving a pilot address. No 7702, sessions,
sponsored swaps or mainnet are included.

## Evidence and enablement

Core tests exercise the installed account adapter's ABI/signature format with
mocked RPC. `PilotBatch.t.sol` proves exact-account settlement attribution and
atomic rollback using a labeled ABI-compatible fixture, **not** a deployed Coinbase
account/EntryPoint. These results do not establish live provider compatibility.

Public integration remains disabled. Before any enablement, separately review the
deployed account/factory/implementation/EntryPoint/paymaster code identities,
account-owner state, provider authorization binding and expiry, zero-ETH first
deployment, payer-funded principal, rescue/recovery, operator costs and actual
Expo-device behavior. No provider endpoint belongs in `EXPO_PUBLIC_*`.

## Budget and storage boundary

`apps/server/src/sponsor/policy.ts` parses explicit server settings. Missing, zero,
negative, noncanonical, overflowing or inconsistent values return no policy:

- `SPONSOR_AUDIENCE`: exact HTTPS origin for signed action proofs.
- `SPONSOR_OPERATION_WEI`, `SPONSOR_OWNER_DAILY_WEI`, `SPONSOR_GLOBAL_DAILY_WEI`:
  maximum reserved native-cost ceilings, in ascending order.
- `SPONSOR_PRINCIPAL_USDC`: maximum principal in six-decimal base units.
- `SPONSOR_CALL_GAS`, `SPONSOR_VERIFICATION_GAS`, `SPONSOR_PRE_VERIFICATION_GAS`,
  `SPONSOR_FEE_PER_GAS`: explicit operation ceilings (fee in wei/gas).
- `SPONSOR_OWNER_CHALLENGES_DAILY`, `SPONSOR_GLOBAL_CHALLENGES_DAILY`: positive
  bounded challenge-attempt quotas, including attempts that later fail validation.

There are **no numeric spend defaults**. Parsing a policy does not enable anything
or read credentials. UserOperation liability bounds include EP 0.6's three-times
verification-gas multiplier for paymasters. Provider markup/L1/data accounting
still needs an independently reviewed cost model; the counters are conservative
reservation ceilings, not an invoice estimator.

`SponsorLedger` uses built-in `bun:sqlite`, schema version 1, WAL, FULL synchronous
writes, a busy timeout and immediate transactions. Opening requires an explicitly
provided absolute database path. Runtime integration must use an approved persistent
local volume and **one host**; ephemeral Railway filesystems and multi-host SQLite
are not accepted deployment designs. Importing modules opens no database. Tests
may inject an in-memory database; persistence tests reopen a temporary file.

Unique owner/idempotency and payer/request keys prevent duplicate logical payments.
Preparation reserves the full per-operation ceiling atomically before any provider
authorization. Concurrent callers/connections cannot exceed owner/global budgets.
UTC-day accounting includes outstanding liabilities from all previous days.
Reservations remain charged at their ceiling after terminal evidence for that
day; uncertain/abandoned/preparing work is never automatically refunded or released
on timeout, restart or expiry. An approved future operator reconciliation process
is needed to release unused liabilities safely. No client endpoint can release them.

Operation state, unsigned prepared operation, UserOperation hash and transaction
hash persist independently of mobile routes. Owner operation signatures are not
stored in the ledger. Unknown ledger versions fail closed; no automatic migration
or deletion is attempted. SQLite files are operational data, not repository files.

## Regression and remaining gates

Existing P1/P2 gates remain required. P3 live regression is required before release
of payment/config changes, but is not run under the current no-spend authorization.
P4 live ENS and physical P5/P6/P7 remain unverified in this implementation session.
No mocked test should be described as provider, token-proxy, deployment, recovery
or native-device validation.
