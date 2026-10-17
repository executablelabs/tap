# Tap wallet delegation — reviewed implementation plan

**Date:** 2026-10-17. **Status:** planning only; all implementation and activation decisions below remain unapproved.

> **Publication note:** This document preserves the completed planning-run report originally saved at `/home/gitau/PersonalCloud/work/Tap/delegation-plan.md`. Its inspection facts, research date and references to the current checkout describe that planning run at HEAD `fab9fffbadae28e97671e101f40481e3711b3f7d`. Statements about no tests, commits, pushes or other modifications also describe that run. The user subsequently authorized adding this repository copy and publishing the completed branch. Publication does not implement delegation or authorize sponsorship activation, funding or deployment.

## 1. Recommendation and exact inspected state

**Start with an isolated, one-use, exact-payment delegation proof, not a reusable spending session and not EIP-7702.** Evaluate an audited-tag MetaMask Hybrid delegator account with existing whole-batch, one-use, expiry and nonce enforcers. Preserve TapPay, the merchant request, live ENS verification, the current EOA and the finalized sponsorship implementation. Do not upgrade the existing Coinbase pilot account into a different account family.

Only progress to reusable permissions after an existing audited account/policy combination demonstrably enforces Tap's complete payment template, recipient restrictions, cumulative accounting and owner-controlled revocation. If it cannot, retain owner-confirmed payments; a custom Tap policy requires separate design/audit approval rather than an improvised contract.

This plan continued the earlier research in the same session after the usage interruption; it did not restart the review.

### Git observations (historical planning run)

| Item | Observed value |
|---|---|
| Repository metadata | `/home/gitau/PersonalCloud/work/Tap` is the bare metadata worktree |
| Inspected application checkout | `/home/gitau/PersonalCloud/work/Tap/app-entry` |
| Branch, independently rechecked | `flow/app-entry` — it still exists |
| HEAD | `fab9fffbadae28e97671e101f40481e3711b3f7d` |
| HEAD subject | `docs(docs): record the disabled sponsorship slice and remaining gates` |
| Application checkout status | Clean, including untracked-file status; status output was only `## flow/app-entry` |
| Separate main worktree | `/home/gitau/PersonalCloud/work/Tap/main`, branch `main`, HEAD `ccdad7df7b8c1a3c80200996c9637239695ff5ad` per worktree metadata; its file cleanliness was not inspected |

Read `CLAUDE.md`, repository documentation/decisions, the actual settlement/account/operation/service code, `/home/gitau/PersonalCloud/work/Tap/web3-herdr-reviewed-plan.md`, and `docs/12-sponsorship-pilot.md`. The older reviewed report describes HEAD `f4657df`; it is historical reference, not current implementation evidence.

The current checkout contains the finalized **disabled sponsorship slice** under D36–D41: Coinbase Smart Wallet 1.1, viem 2.56.9, EntryPoint 0.6, Base Sepolia, root-owner authorization, strict direct-USDC batches, SQLite liabilities and mobile pending journals. Its public app composition mounts sponsorship unavailable with no live gateway. This is a source-code observation, not a claim about a deployed service, which was not queried.

**Planning-run activity:** No source/configuration/dependency changes, tests, builds, commits, pushes, provider activation, deployment, funding, signing or key access were performed during the planning run. Its only authorized modification was the external report file. No `.env`, on-device storage value or provider credential was inspected.

## 2. Mechanisms that must remain distinct

| Mechanism | Authority it actually provides |
|---|---|
| Reusable constrained session/payment permission | A separate key can execute a bounded class of future actions without a fresh root signature for each action; wallet contracts/modules must enforce the limits. |
| One-use exact-payment grant | Authorizes one particular verified request and exact execution. It is the recommended first proof, **not** a reusable merchant-budget session. |
| EIP-7702 code delegation | Installs persistent code authority at an EOA address. The authorization does not contain merchant, token, amount, window or expiry limits. It can persist despite subsequent transaction failure. |
| ERC-7715 | Wallet permission-request RPC interface; not an enforcement engine or an existing capability of Tap's local signer. The fetched standard remains Draft. |
| ERC-1271 | Contract signature validity, potentially dependent on current state/time/owner configuration. Its view validation is not a mutable spending counter. |
| Paymaster authorization | Authority to spend sponsor gas funds, not permission to spend the customer's principal. |
| ERC-20 allowance/permit | Token spending authority; it is not an account session, and permit deadlines do not generally expire an already-created ERC-20 allowance. |

**Keep EIP-7702 out of this pilot.** It is unnecessary for testing constrained delegation, changes the existing EOA's authority and signature behavior, and complicates root compromise, initialization, storage and exit. If considered later, require a separate decision: chain-specific installation, audited initialization, signature parity, code-clearing/resurrection tests and honest recovery limitations. Clearing code is not the same as revoking grants or token approvals. The original EOA private key retains protocol authority even after a code-level guardian recovery. [S1, S2, S3]

## 3. Compatibility constraints established from Tap

### Settlement and signatures

`contracts/src/TapPay.sol:65,80–81` makes the caller the permit owner, token source and `Paid.payer`. A session EOA, server, DelegationManager or generic relayer must not call TapPay as a substitute payer. The **funding customer account** must emit the calls:

```text
USDC.approve(canonical TapPay, exact request amount A)
TapPay.pay(original request, original merchant signature)
```

Both calls must originate from that account, use zero native value and revert together. Successful settlement must move exactly A to the signed merchant and leave the intended allowance state, initially zero for this narrow proof. No raw token-transfer substitute: it would not settle the canonical request or produce the required evidence.

`packages/core/src/payment/pilot-calls.ts` supplies reusable inner-call data. Its **outer Coinbase `executeBatch` encoding is account-specific**; do not reuse those wrapper bytes as MetaMask/ERC-7579 execution bytes. Translate through the selected SDK and prove identical inner effects.

The current `pilot-operation.ts` verifies owner index zero and the root owner's Coinbase signature over an EP 0.6 operation. Replacing its signer with a session key, adding a session key as a full funding-account owner, or loosening verification after root verification fails would defeat the security model. A new capability path must be additive.

ERC-1271 compatibility is separate for merchant signatures, owner-signed grants, session operations and general wallet messages. Preserve full contract signature bytes; do not truncate them into `v/r/s`. Use approval+pay, not smart-account USDC permit, for the delegation proof. Grant the session **no general ERC-1271 signing authority** for permits, orders or unrelated messages. [S3]

### Receipt and authentication changes are substantive

In a MetaMask redemption design, distinguish:

- **Payer/delegator:** customer account holding USDC.
- **Executor/delegate:** separate execution account controlled by the session key.
- **Outer UserOperation sender:** executor.
- **TapPay `Paid.payer`:** customer delegator, not executor.

Current `pilot-receipt.ts` requires `Paid.payer == op.sender`; it should continue to reject a delegation receipt under that direct-payment model. Do not weaken it globally. A new receipt adapter must bind the executor UserOperation, canonical manager/grant redemption and the customer's exact `Paid` event within the same operation execution range. Whole-bundle success, a standalone `isPaid`, or a successful unrelated grant is insufficient.

The current sponsor proofs require root authorization for prepare/submit/status. They are not reusable session authentication. A future reusable path needs owner-authorized grant registration, plus action-specific delegate proofs bound to the registered payer, executor, permission, request and operation. Public grant data must not authenticate owner-only revoke/exit actions.

### Runtime and stack

Actual manifests: viem **2.56.9**, Expo **57.0.25**, React Native **0.86.3**, React **19.2.3**, SecureStore **57.0.4**. No MetaMask/SmartSessions/ZeroDev session package is selected or installed by this plan.

The inspected MetaMask adapter uses EP **0.7** and its account-specific signing digest. This differs from Tap's Coinbase/EP **0.6** path and its receipt hash. Pin the SDK's signing digest separately from the EntryPoint UserOperation hash used for receipt identity. Do not port EP 0.6 fee/prefund arithmetic into a different EntryPoint version. Base Sepolia appearing in a network table proves neither provider acceptance nor Expo/Hermes compatibility. [S4, S5]

## 4. Account/module alternatives and proof gaps

| Alternative | What existing components provide | Fit and recommendation |
|---|---|---|
| Current Coinbase 1.1/EP 0.6 | Owner-controlled account, atomic batch, ERC-1271 and upgrade/owner mechanisms. Coinbase Spend Permissions provide token/period permissions but transfer to the spender. | No demonstrated drop-in constrained execution module in this account path. Spend Permissions do not call TapPay from the customer account. An adapter or privileged contract owner would add a new trust surface and potentially change payer attribution. Keep this existing path owner-confirmed. [S6, S7] |
| Separate MetaMask Hybrid account + DelegationManager | Existing exact-batch, call-count, timestamp and nonce enforcers; manager executes from the funding account. | **Preferred one-use proof candidate**, subject to audited-tag/code/provider/RN gates. It requires a new expressly selected pilot account, not an in-place Coinbase implementation swap. [S4, S8–S13] |
| ERC-7579 account + SmartSessions | Action and UserOperation policies, counters, signature policies and batched account execution. | Best comparative candidate for later reusable permissions, but no proof yet of Tap's entire dynamic-tuple, two-call, equal-amount and cumulative/window requirements. Do not assume ERC-7579 modules install on Coinbase 1.1. [S14–S18] |
| ZeroDev Kernel permissions | Target/method/argument/value, timestamp, gas and rate policies; modern Kernel v3/EP 0.7 versus legacy v2/EP 0.6 differ. | Credible alternative proof track, not a compatibility shortcut. Generic call limits plus a UserOperation count do not establish a USDC cumulative budget or exactly one payment per operation. Its reset-rate documentation explicitly warns of bundler compatibility restrictions. [S19–S21] |
| Custom Tap policy/enforcer | Could decode/link the full request/batch and implement shared monetary counters. | Not the default. Requires separate requirements, audit scope, deployment and dependency decisions. Do not deploy an unaudited convenience enforcer or modify TapPay to make a library example fit. |

### Findings that rule out superficial policy reuse

1. MetaMask's `ERC20PeriodTransferEnforcer` checks a direct `IERC20.transfer` in single-call/default mode. It does not meter TapPay-mediated `transferFrom` or this two-call batch. A balance-change guard alone is not a persistent monetary window/lifetime counter. [S12]
2. Rhinestone's documented call helper supports static parameter types. TapPay's request is a tuple containing a dynamic string, and its signature is dynamic bytes. A demonstration using `transfer(recipient, amount)` does not prove those nested constraints. Its documented parameter accumulator is promising, not Tap-specific proof. [S15]
3. Rhinestone's `maxUses` is independently applied per function/chain, not a single shared grant counter. Allowing approve and pay independently does not enforce order, pairing or equal amounts. A single-call approval, partial batch or repeated pay must not slip through. [S16]
4. Rhinestone documents a wildcard intent fallback unless `restrictToActions` is set. It also warns that reusing a permission ID can add policies, not replace earlier authority; strict salt does not revoke the old permission. These are explicit negative tests, not acceptable defaults. [S17]
5. SmartSessions v2/Emissary adds Compact/intent/allocator mechanisms. Its README describes allocator involvement in updates/disabling. Do not import that cross-chain stack into this direct-payment pilot or assume the v1 audit covers v2. Reject any chosen configuration without an independently proven owner exit. The official audit index is evidence of report availability, not proof the selected SDK/deployment matches an audited revision. [S18]

## 5. Recommended first pilot: one-use exact grant

### Execution topology

```text
Owner: separately approves account setup and later one exact verified payment grant
Device: stores separate ephemeral session key; retains grant/revocation metadata
Executor: session-controlled smart account, with no customer principal
Bundler -> reviewed EntryPoint -> executor
    -> reviewed DelegationManager.redeemDelegations
    -> funding customer account.executeFromExecutor(BatchDefault, exact calls)
        -> USDC.approve(TapPay, A)
        -> TapPay.pay(original request, merchant signature)
```

Use both MetaMask account roles on one reviewed EP 0.7 environment as the simplest initial proof candidate. Do not add a mixed EP 0.6/0.7 bridge merely to reuse an existing executor. A session key may own an **otherwise empty executor**; it must never become a full owner of the USDC-holding funding account. Do not expose the executor as the user's funding address or fund it with customer principal.

Deploy/prove required account setup before scanning a short-lived payment request. No hidden account deployment, module installation or upgrade in the payment grant. Live setup/deployment/funding remains separately authorized future work.

### Exact grant policy

| Dimension | Required binding |
|---|---|
| Chain/domain | Base Sepolia; exact manager EIP-712 chain/address/domain version; no chain-zero/multichain authority. |
| Accounts/key | Exact funding account and designated executor/session identity; no ANY_DELEGATE. |
| Calls | Exact decoded two-element execution: canonical USDC approval of canonical TapPay for A, then original TapPay.pay bytes. Both values zero. |
| Merchant | Full original request, including merchant recipient, name, token, A, nonce, expiry and merchant signature. Owner signs only after live verification. |
| Execution | `ExactExecutionBatchEnforcer`, batch/default revert-all mode; no single, try, delegatecall, generic self-call or nested escape. |
| Successful uses | `LimitedCallsEnforcer` limit **1**. A failed/reverted attempt can roll back its counter; this is not a one-attempt gas-cost ceiling. |
| Expiry | Finite upper timestamp no later than request expiry and an approved short lease. Proposed proof lease: at most 60 seconds, pending product approval—not an active default. Test the enforcer's exclusive time boundaries. |
| Revocation | `NonceEnforcer` at the payer/manager epoch plus individually disableable root-grant hash. Persist metadata needed for both before releasing authority. |
| Principal | Per-payment and lifetime amount equal exact A, subject to an explicitly approved pilot cap. Within this one grant's validity window, successful spend is at most A. No recurring/daily reusable allowance is claimed. |

Existing exact-batch/time/count/nonce enforcer source supports this as a **candidate without a custom Tap contract**. Implementation must select an audited release that actually contains this combination and test it end to end. Upstream `main` is explicitly a development branch, not an audit certificate. [S8–S13]

The exact-batch enforcer compares decoded executions. Off-chain code must generate canonical bytes, and differential fuzzing must prove that noncanonical outer offsets, aliasing or trailing data cannot make the enforcer and account execute different effects. Do not claim an off-chain canonical-byte check protects other-provider execution.

### Subdelegation and multiple-grant limits

The source applies all ancestor caveats and checks disabled parents; counts are keyed by manager/root-grant hash. Descendants must not gain a fresh parent spend allowance. However, `RedeemerEnforcer` explicitly warns that delegating accounts can route around redeemer restrictions. It is **not** proof that subdelegation is impossible. [S10, S13]

Require no broadening of ancestor authority, no customer-account administrative delegation, and adversarial nested-redemption tests. If product requires strict chain-depth-one/non-redelegatability, stop this candidate until an existing audited mechanism proves it or a separately reviewed solution is approved. Key sharing itself cannot be cryptographically prohibited by a normal bearer key.

Allow one outstanding grant operationally. If a cryptographic latest-grant-only guarantee is required, advance and confirm the payer's epoch before signing a successor. Per-grant one-use limits are not a wallet-wide daily cap across several owner-authorized grants.

### UX and assurance

- Account selection/setup, grant authorization, payment submission and revocation are separate states.
- After explicit NFC/QR scanning, display live-verified merchant identity, exact USDC principal, funding account, grant expiry and fee payer. Show “fees paid by Tap” only after actual eligibility is known.
- The first pilot's owner action authorizes **this exact payment**, then the session executor submits it. Signing/accepting a grant is not payment success.
- A later reusable grant removes repeated root signing, not necessarily the app's Pay button. Retain explicit scan, verification and “Pay using permission” for every payment; background/autonomous spending remains out of scope.
- A stolen reusable key can exercise valid in-scope authority without a real button press. If cryptographic per-payment owner consent is mandatory, keep per-payment root signatures or exact one-payment grants. Do not label a broad reusable grant as cryptographic confirmation of every future payment.

## 6. Reusable permissions: a distinct, gated second pilot

Start only after the one-use path, owner exit and account/provider compatibility pass. Narrow candidate scope: one chain, canonical USDC, one explicitly approved merchant address/name association, one funding account, one active session and a short fixed lifetime. No ETH-value transfers, swaps, arbitrary wallet signatures or administrative calls.

Required on-chain policy—not merely SQL/mobile checks:

| Requirement | Proof needed |
|---|---|
| Asset/target/method | Canonical USDC and TapPay only, exact approved selectors, zero value; no wildcard fallback or alternative spending route. |
| Atomicity/cardinality | Exactly one approval plus one payment, revert-all, no extra/standalone/reordered calls; approval amount equals request amount. |
| Recipient | Decode and bind `req.merchant`; pin the permitted name association as well. A target allowlist containing TapPay does not restrict its merchant argument. |
| Monetary limits | Per-payment P, lifetime L and optional window W must meter all successful mediated spending. Actual USDC effects and declared request amounts must agree. |
| Counter scope | Account/asset/stable policy bucket or an explicitly documented grant scope; multiple grants, replacements, salts, nonce channels, batches and signer rotation must not silently reset/multiply an advertised shared budget. |
| Window | Define fixed versus rolling window, anchor, boundary behavior, no unintended carryover, and maximum at a boundary. Expiry alone is not a rolling budget. |
| Replay | Grant epoch/ID, operation nonce, original merchant nonce, chain/domain and code/policy version. |
| Gas | Restrict fee-payer/gas authority separately from principal; zero call value does not prevent a same-sender UserOperation from consuming the customer's ETH. |

Prove the exact module's policy scope: a per-function accumulator is not a shared wallet budget; a rate cap counts operations, not token amounts; N operations imply a monetary cap N×P only if every operation is proven to contain at most one payment. This is a conservative derived cap, not a generic monetary window policy.

Do not hand-wave dynamic tuple offsets. A raw-offset policy is acceptable only after proving canonical head offsets, bounds and equivalent decoding at every layer. If existing audited components cannot express whole-batch pairing and cumulative/window accounting, **do not ship reusable permissions**. Propose a separately audited Tap-specific policy, or keep the owner-confirmed/one-use architecture. No such custom contract is authorized by this plan.

## 7. ENS and policy-bound sponsorship

ENS identity lives on Sepolia while payment execution is on Base Sepolia. TapPay validates merchant signature/nonce/expiry but does not resolve ENS on-chain. Preserve full verification on the device and service near authorization and submission; unknown RPC/ENS state fails closed.

The enforceable distinction is:

1. One-use grant: owner authorizes exact recipient/request after live verification, with short validity.
2. Reusable grant: on-chain recipient restriction can bind an approved address/name, but cannot by itself establish its **current** Sepolia ENS state at Base inclusion.
3. Sponsor service: refuses sponsorship for stale/mismatched/unverified identity, but a stolen session may try another provider or self-funded route.

If “only currently verified merchants on every execution route” is a product requirement, stop generic reusable grants until an approved cross-chain proof/attestation or independently enforced co-authorization design exists. A backend cosigner would be a new availability/trust decision, not a free property of gas sponsorship. Do not pretend an address snapshot is live cross-chain ENS enforcement.

Extend sponsorship through a separate permission-aware capability rather than accepting session signatures in the root-owner verifier:

- Owner-controlled grant registration; distinguish unredeemed off-chain authorization from installed module state. Verify ERC-1271/root signature, terms, code identities, epoch, disable state and expiry.
- Delegate-signed request proofs bind HTTPS audience/action, grant/policy hash, payer, executor, merchant request/calls, intent and operation nonce. A public grant cannot authorize owner exit.
- Validate the complete executor wrapper, every manager permission context/mode, all ancestor caveats and every inner call. Exactly one payment redemption; no deployment/upgrade/module/grant-management extras.
- Keep operator endpoints/credentials server-side. Require issuance bound to the entire operation, gas/fee bounds, short validity and idempotency. No open RPC forwarding.
- Budget by root owner/funding payer/grant as well as executor; rotating an executor must not mint more sponsor credit. Retain durable reservations, failure accounting, read-abuse controls and circuit breakers.
- Keep principal budgets, sponsor expense and emergency defensive reserve separate. Reverted attempts may cost gas while on-chain principal/use counters roll back.

CDP documents Base/Base Sepolia support but pairs its paymaster with its own bundler. That does not establish acceptance of the new EP 0.7 manager/redemption wrapper or permit mixing a CDP paymaster with a different bundler. Prove the exact tuple, including token-fee absence; application-paid gas must not silently become customer-paid USDC gas. [S22]

## 8. Revocation, owner exit, custody and upgrades

### Owner-controlled revocation and emergency lane

Stop local signing immediately on suspected compromise. Then use the funding account's root-owner authority to disable the grant and/or increment its manager-scoped epoch. The compromised session must not be required to approve its own removal. Revocation of a parent must invalidate descendants; test old signatures after disable/re-enable and after epoch/key changes.

Distinguish local suspension, revocation submitted, revocation confirmed, expired and unknown. Deleting the key/consent/handle does not revoke a leaked copy. Reconcile payments that executed before the revoke; revocation cannot undo them.

Before any funded trial, prove a **separate narrowly sponsored defensive lane** for owner-authorized disable/epoch invalidation, canonical approval-to-zero and an explicitly reviewed owner exit. It must work at zero customer ETH and when normal payment quotas are exhausted. Owner exit, if included, transfers only to an explicitly confirmed recovery destination; the session cannot invoke it, change owners or choose a hidden recipient.

The existing sponsor's exact payment validator intentionally rejects these admin/exit calls; do not bypass it with a general self-call allowlist. Use distinct, exact defensive templates and budgets. Provider emergency pause must not automatically disable the defensive lane.

Prove an independent owner path: owner-signed self-funded UserOperation through the reviewed EntryPoint with available payer ETH/deposit, or another complete approved compatible sponsor/bundler pair. MetaMask core execute is EntryPoint-gated; do not assume the Coinbase owner's direct EOA-to-account execute fallback works there. During total provider/network outage, a zero-ETH owner may have to wait. Do not promise free instant revocation in every outage.

### Device loss and key lifecycle

- Generate a distinct device-side session key per account/chain/environment/purpose; store it in a new versioned SecureStore namespace, never `tap.wallet.v1` or ordinary preferences/AsyncStorage.
- Persist grant metadata, permission ID/hash, exact scope, account/executor, epoch, expiry, code/policy fingerprint and operation/revocation hashes before releasing authority. Treat signed grants as sensitive capabilities; never send private keys or log grants/full signatures to analytics.
- On handle loss, recover metadata from approved service/on-chain evidence; it does not recover a lost private key. Revoke the old key and authorize a new one. Confirm old authority is unusable before treating rotation as complete.
- On full device/root loss, current Tap has no independent recovery. Require a separately approved recovery owner/guardian/passkey/export design before meaningful balances. The session key must never recover or promote itself to root.
- Current `WalletProvider.tsx` retains a `LocalAccount` in app memory. A session does not protect against arbitrary compromised JS that can access the root. Root-signing isolation and merchant-role effects need an explicit design before claiming that protection.
- Expo SDK 57 documents uninstall/backup limitations, large-value errors and biometric enrollment invalidation. A missing/invalidated key in an already-provisioned wallet must trigger recovery, not silent generation of a replacement owner. Do not toggle biometric storage semantics on the existing key without migration/recovery approval and real-device tests. [S23]
- Block development wallet reset while any active grant or unresolved payment/revocation exists—not only while a payment journal is present. Lost/local-forgotten grants can remain valid on-chain.

### Upgrades and root compromise

Pin account proxy implementation, EntryPoint, manager, enforcers/validators and policy versions. Session authority must exclude upgrades, owner/module changes and new grants on the customer account. On code/owner/module/domain changes, suspend signing and sponsorship until revalidated; do not silently reinterpret old consent.

Test storage-retaining and storage-clearing upgrades, reused addresses, changed validators and re-enabling modules. Preserve permanent invalidation/epoch semantics so old permissions do not resurrect. Contract-owner recovery may invalidate signatures but does not universally clear installed session permissions or allowances. Root compromise is broader than session compromise; session rotation alone is not recovery.

## 9. Pending and receipt reconciliation

Reuse the existing conservative lifecycle principles, not its direct-sender assumptions. Persist at least:

```text
owner profile + funding payer + executor + chain + account/EntryPoint identity
grant/permission ID + root epoch + policy/code fingerprint
original merchant request hash/nonce + exact inner calls hash
intent/idempotency ID + signing digest + all UserOperation/replacement hashes
transaction hash + payment/grant/revocation evidence + canonical status
```

Track account deployment, grant authorization/installation, payment and revocation separately. Off-chain MetaMask grants may be authorized before any redemption event; do not fabricate an installation transaction. SmartSessions installation/enablement has different state requirements.

After a timeout, process kill, missing receipt, provider disagreement or reorg, remain pending/unknown. Do not release liabilities, erase the key, reissue a broader grant, switch to EOA fallback, or create a new merchant nonce just because the request expired. An earlier payment may already have succeeded.

A delegation-specific canonical receipt reader must verify the correct outer EntryPoint UserOperation and executor, expected manager/root-grant redemption and exact customer `Paid` evidence inside the same operation range. With a same-sender modular validator alternative, the topology differs; prove that adapter separately. A paid request belonging to another customer is not this customer's payment.

Any replacement keeps the logical intent, grant, request nonce, payer and inner effects; explicitly track every operation hash and nonce. Resubmit only after defined canonical reconciliation and approval. Confirmed failure may leave a one-use grant unconsumed because execution rolled back; an explicit retry must still satisfy expiry, ENS, sponsorship failure limits and the original scope. No automatic retry is proposed.

## 10. Phased, file-specific future work

All paths below are proposed future edits; none were made by this plan. SDK/Flow/shared ownership and locked API/contract/dependency decisions in `CLAUDE.md` still apply. Record actual approval, not fabricated teammate consensus.

| Phase | Concrete work and files | Exit gate |
|---|---|---|
| 0 — decision/specification | `docs/decisions.md`, `02-architecture.md`, `03-contracts.md`, `05-sdk-core.md`, `06-sdk-react-native.md`, `07-mobile-app.md`, `09-quality-and-commits.md`, `10-build-plan.md`, `12-sponsorship-pilot.md`; specify separate one-use proof and later reusable scope. | Account-change, UX, numeric, recovery and dependency/audit decisions approved; no new decision numbers presumed here. |
| 1 — executable enforcement proof | Proposed `contracts/test/DelegationPayment.t.sol`, versioned fixtures under `contracts/test/fixtures/`, and `packages/core/test/wallet/delegation.test.ts`; use pinned real audited framework contracts/artifacts, not merely an ABI-compatible fixture. Prove payer attribution, exact batch, one-use/time/epoch and owner revocation locally. | No custom Tap contract; audited-tag/source/deployment mapping and all negative-path tests pass. Resolve Foundry/OZ compatibility through explicit dependency decisions, not a hidden second OZ copy. |
| 2 — additive core capability | New `packages/core/src/wallet/delegation-account.ts`, `delegation-grant.ts`, `delegation-policy.ts`; new payment encoding/operation/receipt adapters under `payment/`; canonical entries in `config/chains.ts`; approved exports/types in `index.ts`/`types.ts`. Reuse `pilotPaymentCalls` inner data. | Distinct owner, payer, executor, signing digest and receipt identities; current Coinbase/EP 0.6 APIs/tests unchanged. No casting a new account into the old literal 1.1 type. |
| 3 — permission-aware sponsor boundary | Proposed `apps/server/src/delegation/{service,auth,policy,grant-store}.ts`; deliberate extensions to sponsor policy/ledger/gateway; new service/ledger tests. Separate root registration/admin proofs from delegate execution/status proofs; include exact redemption wrappers and defensive templates. | Durable/idempotent state, quotas/reservations and policy-bound provider authorization proven. Any schema migration preserves old unknown liabilities; no open proxy or environment-only activation. |
| 4 — mobile grant/signing UX | New grant-management screen/component; versioned session-key/metadata storage under `apps/mobile/src/wallet/` or `src/delegation/`; changes to `WalletProvider.tsx`, `key-storage.ts`, `preferences.ts`, `copy.ts`, settings and verified confirmation. Extend `src/sponsorship/session.ts`/`pending.ts` through explicit versioned adapters without erasing old journals. SDK `useTapToPay`/state-machine changes only through reviewed interfaces. | Explicit opt-in and grant scope, owner-versus-session signing distinction, no auto-scan/pay, cold/warm link retention, failure-safe storage and backward-compatible direct flows. Root isolation/recovery claims match implementation. |
| 5 — revoke/exit/recovery acceptance | Root-only administrative core/service templates, account/grant status synchronization, pending revocation/exit UI, independent owner route and device-loss runbook. Extend key-reset guards to active grants. | Zero-ETH/quota-exhausted revoke works in the exact stack; independent exit and recovery assumptions demonstrated before funding. |
| 6 — controlled one-use pilot | Explicitly authorized Base Sepolia deployment/funding/provider/device experiments, after phases 0–5. Keep production/mainnet off and operator limits unset until approved. | Exact stack, costs, receipts, P1–P7 regressions and physical acceptance; no compatibility claim from mock flags. |
| 7 — reusable policy RFC | Only after the prior pilot: compare exact SmartSessions/Kernel/MetaMask policy releases for one-merchant recurring requests; add shared counters/window proofs and root-isolated signing. | Every requirement in section 6 proven with existing audited components, or stop for a separate custom-policy audit decision. Swaps remain excluded. |

Future checks use pinned tooling, for example `mise -C /home/gitau/PersonalCloud/work/Tap/app-entry exec -- bun run check`, meaningful focused Bun/Foundry suites and the Android export. The planning run did not execute them; the full gate includes ABI generation and would have violated that run's no-source-change constraint. Publication verification is separate from those historical planning-run activity facts.

## 11. Required security and physical-device tests

### Local/contract/SDK proof

- Exact approve+pay from the funding account; event payer is that account, not executor/manager/bundler. Compare real SDK encoding with the actual account/enforcer decoder.
- Settlement failure rolls back approval, token movement, request nonce and enforcer use count. Successful use cannot settle again across another executor, nonce channel, provider or child delegation.
- Wrong chain, account, manager, EntryPoint, root/delegate key, audience/action, epoch, signature wrapper or grant/policy fingerprint rejected. Distinguish signing digest from receipt hash.
- ERC-1271 bad magic value, reverting/state-changed signer, owner rotation and counterfactual/deployed mismatch rejected. No unrestricted session EIP-1271 permits/orders/messages.
- Time just before/at/after every boundary, request expiry, one-use exhaustion and recovery after expiry. No infinite expiry from zero/default fields.
- Missing/zero/overflowing principal, gas, monetary/window or sponsor settings fail closed. Parent counters cannot be reset by a child/salt/session restart/alternate nonce.

### Malicious execution and reusable-limit proof

- Wrong asset, merchant recipient/name, spender or approval amount; amount mismatch between approval/payment; nonzero native value; standalone/extra/reordered/repeated calls.
- Single/try/delegatecall/CREATE/module-install/upgrade/owner-change/self-call modes, wildcard fallbacks, ANY_DELEGATE and nested redemption paths.
- Noncanonical/overlapping/out-of-bounds dynamic offsets, trailing data, alternate tuple/signature layout and decoder disagreement. Entire inner request/signature bytes remain bound.
- Multiple permission-context arrays/ancestor chains in one manager batch, multiple root grants and extra outer executor calls; sponsor issuance binds all of them or rejects the operation.
- Direct self-funded/other-provider attack with a stolen key stays inside wallet-enforced principal limits. Do not rely on the sponsor or a mobile clock as the spending enforcer.
- For reusable candidates: mediated transfer accounting, equal-amount pairing, multiple payments in one operation, period-boundary bursts, per-function versus wallet counters, multi-grant/key rotation and configuration re-enable/reset.

### Sponsorship, pending and defensive proof

- Replay registration/intent/proofs; concurrency and idempotency with changed payload; rotating executor cannot bypass payer/owner limits. Failed operations consume/reconcile sponsor cost correctly.
- Provider timeout after successful send, unknown hash, temporary not-found, app kill, replaced operations, successful bundle/failed operation, another payer settling the request and reorg handling.
- Corrupt/oversized/missing-after-provisioning SecureStore records, simultaneous/stale controllers and schema changes cannot clear or replace known pending authority.
- Parent revoke/epoch invalidation versus pending inclusion; root exit without the session's cooperation; normal sponsor quota exhaustion; sponsor pause; framework manager pause; independent self-funded route.
- Revocation/rotation cannot be faked by deleting a key, forgetting consent, reinstalling, changing a local clock or marking a server row revoked. Upgrade/uninstall/reinstall must not resurrect old authority.

### Physical devices — mandatory, not established here

Use an actual Expo dev build, initially the recorded Samsung S23 and A56 or explicitly recorded replacements. Verify:

1. Original EOA/merchant identity and separate customer account selection are preserved; no transfer/deployment happens on preview or ordinary launch.
2. Grant summary/expiry/limits are readable; cancellation creates no spend authority; account setup is separately approved.
3. NFC and QR reach the same verified payment pipeline; tampered requests/ENS outages never show Pay. No scan/pay starts on launch, refocus, incoming-link handling or Done.
4. Local signing, SDK hashes, UserOperation packing and bigint serialization work under Hermes; no hidden browser/Node/polyfill dependency.
5. Lock/unlock, biometric enrollment changes, storage write failure, process death and reinstallation lead to honest locked/recovery states, never a silent new owner or false revocation.
6. Pending payment and revoke survive restart; old and new signers cannot race around limits; no automatic fallback.
7. Zero-ETH sponsored revoke/exit and the independent owner path work with the exact provider configuration; run P5 NFC, P6 QR and P7 tamper with fake chain off.

P1/P2 must remain green; approved live P3/P4 regression and all phone checks are future acceptance gates, not tests performed in this planning session.

## 12. Decisions, activation gates and stop conditions

### Product/numeric decisions still required

- Accept a separate delegation-capable test payer/executor pair, or require the current Coinbase account. If the latter, retain owner-confirmed payments until a separately reviewed account-compatible policy path is proven.
- First proof is one exact payment: one successful use, exact A, approved maximum A and a finite lease no longer than request expiry. The suggested 60-second maximum lease needs approval. No funded principal or gas budget is supplied by this plan.
- For reuse: approve P (per payment), L (lifetime), W (window amount), duration/anchor/rolling semantics, session expiry, maximum operations and active grants, and whether limits aggregate across keys/grants/accounts. Missing numbers deny creation.
- Choose explicit Pay for every payment versus cryptographic root approval for every payment. These are not equivalent once a reusable key exists. No unattended/background payment in either proposed pilot.
- Decide whether verification-at-authorization plus repeated app/service ENS checks is acceptable, or require current ENS across every route; the stronger requirement blocks generic reuse without additional approved enforcement.
- Approve per-operation/owner/payer/global sponsorship ceilings, failed-operation/read-abuse limits, fee-payer restrictions, defensive reserve and provider billing model. No fixed USD price inferred from testnet/mock gas.
- Approve recovery trust/guardian/passkey/export model, owner signing isolation, device loss behavior, revocation SLA, emergency recipient policy and partial/total-outage limitations.
- Choose exact audited contracts/SDK versions and dependency changes; no blanket approval of a latest release, account upgrade or provider migration is assumed.

### Activation checklist

1. **Decision gate:** scoped implementation authorization, repository locked/shared approvals and numeric/recovery choices recorded honestly.
2. **Code gate:** exact audited tag/commit, audit scope/findings and deployed bytecode/implementation/factory/manager/enforcer identities match; no unaudited custom policy.
3. **Enforcement gate:** real-contract local/fork proofs and adversarial matrix pass for the full topology, including alternate-provider and nested paths.
4. **Stack gate:** exact chain, account roles, EntryPoint, account-specific signature modes, SDK/Viem and Expo/Hermes compatibility proven. Network listings and mock readiness flags are insufficient.
5. **Sponsorship gate:** complete approved bundler/paymaster pair, full-operation authorization binding/expiry, server-only secrets, durable budgets and cost accounting; no broadening of the finalized root-only path.
6. **Exit gate:** independent root revocation/epoch/approval cleanup, sponsored defensive reserve and account-specific owner exit/recovery demonstrated before any meaningful balance.
7. **Acceptance gate:** pending/reorg behavior, backward compatibility, actual P3/P4 and physical P5/P6/P7 checks; separately authorized deployment/funding/activation. No mainnet or swaps.

**Stop rather than weaken policy if:** exact batch/recipient/dynamic tuple interpretation cannot be proven; token spending is only limited off-chain; a wildcard/sudo/generic-signature/administrative escape is required; owner-independent revocation is unavailable; provider pairing or EntryPoint fails; current account preservation would require an unreviewed implementation swap; strict non-redelegatability is promised without proof; current ENS at inclusion is claimed without cross-chain enforcement; budgets/counter scopes reset on rotation; or native signing/storage/recovery cannot be demonstrated. A custom enforcer, new custody/co-signer, provider change or account migration requires a new decision, not a silent workaround.

There is **no blocker to completing this plan**. Those are explicit blockers to future implementation/activation of the respective capability.

## 13. Primary sources consulted

Research access date: **2026-10-17**. Preserved research from before the interruption was used alongside the continuation reads. Documentation/source proves the stated capability or limitation, not successful Tap interoperability. Mutable `main` source must be replaced with exact audited pins before engineering approval. Audit indexes were read; full audit reports/deployed code matches were not independently verified here.

- **S1 — EIP-7702:** https://eips.ethereum.org/EIPS/eip-7702 — persistent code authority, authorization fields, nonrollback, clearing/storage/security implications.
- **S2 — ERC-7715:** https://eips.ethereum.org/EIPS/eip-7715 — Draft permission-request RPC, separate from enforcement and redemption.
- **S3 — ERC-1271:** https://eips.ethereum.org/EIPS/eip-1271 — contract/state-dependent signature validity and non-mutating validation.
- **S4 — MetaMask supported networks:** https://docs.metamask.io/smart-accounts-kit/get-started/supported-networks/ — versioned Base Sepolia listings, not provider/RN proof.
- **S5 — MetaMask account adapter:** https://github.com/MetaMask/delegation-toolkit/blob/main/packages/smart-accounts-kit/src/toMetaMaskSmartAccount.ts — inspected EP 0.7 and separate grant/account signing domains.
- **S6 — Coinbase account source:** https://github.com/coinbase/smart-wallet/blob/main/src/CoinbaseSmartWallet.sol — owner authorization, batch, ERC-1271 and upgrade surface.
- **S7 — Coinbase SpendPermissionManager:** https://github.com/coinbase/spend-permissions/blob/main/src/SpendPermissionManager.sol — `spend` transfers account tokens to the spender; not Tap request settlement.
- **S8 — MetaMask caveats:** https://docs.metamask.io/smart-accounts-kit/reference/delegation/caveats/ — exact execution, counts, time, nonce and dynamic calldata cautions.
- **S9 — ExactExecutionBatchEnforcer:** https://github.com/MetaMask/delegation-framework/blob/main/src/enforcers/ExactExecutionBatchEnforcer.sol — exact decoded execution array in batch/default mode.
- **S10 — DelegationManager:** https://github.com/MetaMask/delegation-framework/blob/main/src/DelegationManager.sol — parent authority/signature/disable checks, hooks, payer execution and pause authority.
- **S11 — One-use/time/epoch sources:** https://github.com/MetaMask/delegation-framework/blob/main/src/enforcers/LimitedCallsEnforcer.sol ; https://github.com/MetaMask/delegation-framework/blob/main/src/enforcers/TimestampEnforcer.sol ; https://github.com/MetaMask/delegation-framework/blob/main/src/enforcers/NonceEnforcer.sol — count scope, exclusive timestamps and owner epoch increment.
- **S12 — Transfer enforcer:** https://github.com/MetaMask/delegation-framework/blob/main/src/enforcers/ERC20PeriodTransferEnforcer.sol — direct transfer/single execution restriction.
- **S13 — Redeemer warning and account/security context:** https://github.com/MetaMask/delegation-framework/blob/main/src/enforcers/RedeemerEnforcer.sol ; https://github.com/MetaMask/delegation-framework/blob/main/src/DeleGatorCore.sol ; https://github.com/MetaMask/delegation-framework/blob/main/README.md ; https://docs.metamask.io/smart-accounts-kit/guides/delegation/execute-on-smart-accounts-behalf/ — redelegation caveat, EntryPoint-gated owner execution, audited tags versus development main, two-account redemption topology.
- **S14 — SmartSessions module:** https://github.com/erc7579/smartsessions/blob/main/README.md — ERC-7579 action/UserOperation/signature policy model and batched execution.
- **S15 — Rhinestone call policy:** https://docs.rhinestone.dev/wallets/session-keys/custom-setup/policies/call.md — static parameter rules and parameter accumulators; https://docs.rhinestone.dev/wallets/session-keys/custom-setup/policies/spending-limit.md — function-level cumulative example, not proof for TapPay.
- **S16 — Rhinestone limits/security:** https://docs.rhinestone.dev/wallets/session-keys/session-limits.md ; https://docs.rhinestone.dev/wallets/session-keys/security.md ; https://docs.rhinestone.dev/wallets/session-keys/custom-setup/policies/usage-limit.md — per-function/chain counters, custody and on-chain revocation boundaries.
- **S17 — Restricted sessions:** https://docs.rhinestone.dev/wallets/session-keys/custom-setup/restrict-a-session.md — wildcard fallback, strict salts, additive old authority and signing-disabled behavior.
- **S18 — Version/audit/provider distinctions:** https://docs.rhinestone.dev/home/resources/audits.md ; https://github.com/rhinestonewtf/smart-sessions-v2/blob/main/README.md ; https://docs.rhinestone.dev/wallets/custom-signer/configuration/erc-4337.md — audit scopes, Emissary/allocator context and separate intent/UserOperation sponsorship.
- **S19 — ZeroDev call policy:** https://docs.zerodev.app/smart-accounts/permissions/policies/call — target/method/argument/value versus wildcard freedom.
- **S20 — ZeroDev rate/session distinctions:** https://docs.zerodev.app/smart-accounts/permissions/policies/rate-limit ; https://docs.zerodev.app/smart-accounts/permissions/session-keys — reset/count/bundler caveats, Kernel/EntryPoint versions, paymaster/native-gas authority.
- **S21 — ZeroDev React Native:** https://docs.zerodev.app/api-and-toolings/faqs/use-with-react-native — official starter references, not evidence for Tap's exact Expo/runtime tuple.
- **S22 — CDP FAQ:** https://docs.cdp.coinbase.com/paymaster/faqs — supported chains and combined bundler/paymaster restrictions, not approval of the proposed delegation stack.
- **S23 — Expo SecureStore, version matched:** https://docs.expo.dev/versions/v57.0.0/sdk/securestore/ — storage/capacity, uninstall/backup and biometric invalidation constraints. The latest page was also checked but points to SDK 58; SDK 57 is the applicable baseline here.

Unsuccessful guessed source paths were not treated as evidence of a missing capability. No live provider, token proxy, account deployment or physical-device claim follows from this research.

## 14. Completion

**Planning is complete.** The safest next engineering request is an explicitly authorized local proof of one exact, one-use delegated payment with an audited existing framework and unchanged TapPay—not reusable sessions on the current Coinbase account and not EIP-7702. Reusable permissions remain a separate approval/enforcement milestone.

The original planning-run report was saved outside the application worktree at `/home/gitau/PersonalCloud/work/Tap/delegation-plan.md`. During that planning run, the sponsorship implementation was not modified, and nothing was committed, pushed, deployed, funded, restarted or activated. This repository copy is published under subsequent, separate user authorization; all delegation implementation and activation gates above remain in force.
