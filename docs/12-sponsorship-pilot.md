# 12 · Disabled sponsorship pilot

D36–D41 record bounded **user** implementation approval, not teammate consensus or
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

`SponsorLedger` uses built-in `bun:sqlite`, schema version 2, WAL, FULL synchronous
writes, a busy timeout and immediate transactions. Opening requires an explicitly
provided absolute database path. Runtime integration must use an approved persistent
local volume and **one host**; ephemeral Railway filesystems and multi-host SQLite
are not accepted deployment designs. Importing modules opens no database. Tests
may inject an in-memory database; persistence tests reopen a temporary file.

Unique owner/idempotency keys and authenticated payer/request claims prevent duplicate
logical payments. Unauthenticated created challenges do not claim a request; otherwise
an observer could squat a victim's pending payment. Earlier offline schema versions
are rejected rather than silently migrated.
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

## Offline service composition (D39)

`createSponsorService(deps)` is a dependency-injected Hono boundary. The **public**
server mounts it with no dependencies: `/api/sponsor/capabilities` reports
`available: false`; prepare/submit return 503. There is no environment toggle or
generic RPC forwarding. A reviewed live gateway is intentionally not implemented
or attached in this slice; an operator endpoint alone is insufficient to enable it.
No secret/config values are read by the module, and no database is opened at startup.

Offline injected tests exercise these bounded endpoints:

- `POST /challenge`: owner, original request URL and idempotency key only. Count
  attempts before verification/RPC; derive the separate account; check account
  state through the gateway; build an immutable audience/account/request/calls
  challenge. Lifetime is at most 60 seconds and never exceeds request expiry.
- `POST /prepare`: intent ID and **prepare** owner proof. Repeat live request/ENS
  verification and paid-state checks; atomically claim/reserve; request provider
  preparation once; validate deployment, paymaster, gas and every exact call.
- `POST /submit`: ID, separate **submit** owner proof and operation signature. Repeat
  verification/account checks and validate the pinned owner wrapper. Persist the
  computed UserOperation hash before the first send; a timeout or mismatched hash
  remains unknown. Repeated requests cannot submit again.
- `POST /status`: ID and separate **status** owner proof. Continue read-only
  reconciliation even after payment enablement is disabled. Require canonical
  chain receipt evidence, not a provider's success assertion. Terminal evidence is
  monotonic. Receipt lookup is separate from transaction submission.

All bodies are bounded and known fields only; rejection responses are generic and
never expose endpoint/error details. Preparation/submit proofs cannot be reused
for a different action or intent. Owner signatures are checked locally; no root or
session key is sent to the server. Stored prepared operations are unsigned.

The injected gateway contract requires explicit network/EntryPoint identity,
on-chain account/factory/implementation/owner checks (including rejecting 7702
owners), exact provider authorization binding/validity, and a trusted canonical
chain receipt reader. Readiness flags in test fixtures **are not evidence** that
any of those live checks passed. Public code cannot turn these flags on via HTTP.
Before production wiring, implement and independently validate that adapter and
the complete operator policy, durable volume, account rescue and Expo acceptance.
Challenge throttles bound expenditure but are not unique-human authentication and
cannot eliminate denial of service by a party generating many addresses.

## Mobile offline coordinator (D40–D41)

Settings offers a read-only separate-account preview and remembered opt-in bound
to owner, payer, chain and version. Global EOA balances/merchant identity are not
switched. The UI remains visibly inactive, and no live remote transport or sponsored
Pay option is attached. Existing direct confirmation checks the pending journal
on focus and immediately before authorizing payment; development wallet replacement
also fails closed if pending storage is unreadable or nonempty.

`apps/mobile/src/sponsorship/session.ts` coordinates the proposed protocol through
an explicitly injected remote interface. It requires matching opt-in and an owner
Pay call, verifies the request, binds the server challenge to locally computed
request/call hashes and the approved audience/account, and saves a separate
`tap.sponsor.pending.v1.<owner>` SecureStore record **before** signing/sending a
prepare proof. It validates every prepared operation field and repeats live
verification immediately before owner operation signing.

The journal stores the merchant request URL, immutable challenge, unsigned
operation and distinct hashes, never an owner operation signature/private key.
An unsigned operation/hash is saved before submission; a timeout never triggers
resubmission or EOA fallback. Restart status recovery signs only the separate
read-only status action and checks a canonical chain receipt through core. Even
persisted/server `paid` assertions are not accepted without matching receipt
evidence. Only an explicit dismissal after verified paid/reverted status writes
the null journal marker. Opt-out does not clear it.

Controllers serialize actions per owner in one JS process and re-read durable
state before acting; a stale resolved controller cannot clear another intent.
Unknown/corrupt/storage-failure/disappeared known journals block new work. No
automatic expiry cleanup exists: an expired request may have settled earlier.
SecureStore capacity/restart behavior and single-device assumptions require actual
Android validation; a write failure prevents the next authorization/submission.
Multi-device recovery/coordination and live transport are not implemented here.

The mobile-to-Hono tests use generated test owners, mocked factory RPC, injected
gateway/readiness/ENS and canonical-receipt fixtures. They exercise real pinned
account encoding/signatures and the service/SQLite protocol, not live compatibility.

## Regression and remaining gates

Existing P1/P2 gates remain required. P3 live regression is required before release
of payment/config changes, but is not run under the current no-spend authorization.
P4 live ENS and physical P5/P6/P7 remain unverified in this implementation session.
No mocked test should be described as provider, token-proxy, deployment, recovery
or native-device validation.
