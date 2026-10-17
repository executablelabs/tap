# Tap: NFC tap-to-pay SDK (ETHGlobal Tokyo 2026)

> **Rules for every Claude Code session. Read this file first, every time.**
> The full plan is in `docs/`. Start at `docs/README.md` and read the docs for your task before writing code.
> If code and docs disagree, **stop and ask**. Don't silently pick one.
> Anything marked 🔒 changes only through a new row in `docs/decisions.md`, agreed by both teammates, in the same commit as the change.

@docs/09-quality-and-commits.md
@docs/decisions.md

---

## 1. The project in five lines
- **Pitch:** turn any phone into a payment terminal for Japan's cash-only merchants, with ENS as the answer to "who am I actually paying?"
- **Flow:** merchant enters $5 → phone broadcasts a signed request over NFC (HCE) → customer taps → wallet verifies the merchant on ENSv2 and shows **"Takoyaki Stand · yoyogi-market.tap.eth ✓ · $5.00"** → one tx on Base Sepolia → both phones green.
- **Killer beat:** a tampered tag shows **"Unverified merchant"** and blocks payment.
- **It's an SDK:** `@tap/core` (protocol, pure TS) + `@tap/react-native` (NFC transport + hooks); the app opens a customer wallet home with deliberate merchant entry (D35).
- **Deadline:** submission **Sun 2026-09-27 09:00 JST**. Never cut the core loop (docs/10).

## 2. Which doc to read
| Working on | Read before starting |
|---|---|
| `contracts/` | `docs/03-contracts.md` |
| ENS namespace, registrar, ENS scripts | `docs/04-ens.md`, `docs/03-contracts.md` (registrar) |
| `packages/core/` | `docs/05-sdk-core.md`, `docs/02-architecture.md` |
| `packages/react-native/` | `docs/06-sdk-react-native.md`, `docs/08-nfc.md` |
| `apps/mobile/` | `docs/07-mobile-app.md`, `docs/06-sdk-react-native.md`, `docs/08-nfc.md` |
| A task from the build plan | its entry in `docs/10-build-plan.md` |
| Demo, README, submission | `docs/11-demo-and-submission.md` |
`docs/09-quality-and-commits.md` (invariants, protected flows, commit rules) and `docs/decisions.md` are imported above and always apply.

## 3. Stack 🔒
| Area | Use | Don't use |
|---|---|---|
| Language | TypeScript (strict) + Solidity | — |
| Runtime, packages, workspaces, scripts, tests | **Bun** (`bun install`, `bun run`, `bun test`, `bunx`) | pnpm, npm, yarn, tsx, ts-node, jest, vitest |
| Server (only if add-on A2 is picked up) | **Hono on Bun** in `apps/server/` | Express, Next API routes |
| Chain library | **viem** (ENSv2-ready version) | ethers, web3.js |
| Contracts | **Foundry**; OpenZeppelin from `contracts-v2`'s checkout; `ensdomains/contracts-v2` | Hardhat, a second OZ copy |
| Bundling packages | `tsup` | — |
| Lint / format | **Biome** | ESLint, Prettier |
| Mobile | **Expo dev build via EAS**, Android APK, expo-router | **Expo Go** |
| NFC | `react-native-hce` (merchant), `react-native-nfc-manager` (customer) | — |
| Keys on device | `expo-secure-store` | AsyncStorage |

Pin exact versions (no `^`/`~`). Don't add, remove or upgrade a dependency unless it's the point of the commit, and say so in the message. Check current docs before assuming an API (Expo, react-native-hce, ENSv2 especially).

## 4. Ownership 🔒
| Track | Owns | Doesn't edit |
|---|---|---|
| **SDK** (Person A) | `contracts/`, `packages/core/`, `scripts/`, `apps/server/` | `packages/react-native/`, `apps/mobile/` |
| **Flow** (Person B) | `packages/react-native/`, `apps/mobile/` | `contracts/`, `packages/core/` internals |
| **Shared** (both agree) | `CLAUDE.md`, `docs/`, root config files, `packages/*/src/types.ts`, `packages/*/src/index.ts` | — |
If the Flow track needs something from `@tap/core` that doesn't exist: ask the SDK track, or add a stub to `types.ts`/`index.ts` by agreement. Never inline chain logic in the app as a workaround.

## 5. Repository layout 🔒 (canonical; don't add top-level folders or packages without a decision)
```
tap/
├─ CLAUDE.md                     # this file
├─ README.md                     # public README (judges read this)
├─ package.json                  # workspaces ["packages/*", "apps/*"] + root scripts (docs/09 §3)
├─ bun.lock
├─ bunfig.toml                   # [install] linker = "hoisted"   (REQUIRED: Metro breaks otherwise)
├─ biome.json
├─ tsconfig.base.json            # strict: true, noUncheckedIndexedAccess: true
├─ .env.example                  # script env vars (§8), no values
├─ .gitignore                    # .env, .env.local (but NOT .env.example), node_modules, contracts/out, contracts/cache, apps/mobile/android, apps/mobile/ios, *.apk
├─ .claude/settings.json         # AI attribution off (INV-20)
├─ .githooks/
│  ├─ pre-commit                 # bun run check
│  └─ commit-msg                 # message format + no AI attribution
├─ .github/workflows/check.yml
│
├─ docs/                         # THE PLAN. Start at docs/README.md
│
├─ contracts/                    # Solidity, Foundry (docs/03)
│  ├─ foundry.toml
│  ├─ src/
│  │  ├─ TapPay.sol                     # Base Sepolia: settles signed requests
│  │  ├─ TapMerchantRegistrar.sol       # Sepolia: issues <label>.tap.eth
│  │  └─ interfaces/ITapResolver.sol
│  ├─ test/
│  │  ├─ TapPay.t.sol
│  │  ├─ TapMerchantRegistrar.t.sol
│  │  ├─ mocks/                         # MockERC20Permit, MockERC1271Wallet, MockPermissionedRegistry, MockTapResolver
│  │  └─ fixtures/hash-vector.json      # shared with packages/core tests (INV-09)
│  ├─ script/DeployTapPay.s.sol
│  └─ lib/                              # forge deps (git submodules): contracts-v2, forge-std
│
├─ packages/                     # THE SDK: what other apps install
│  ├─ core/                             # @tap/core: pure TS, zero RN/Expo (docs/05)
│  │  ├─ src/
│  │  │  ├─ index.ts                    # 🔒 public API (re-exports only)
│  │  │  ├─ types.ts                    # 🔒
│  │  │  ├─ errors.ts
│  │  │  ├─ format.ts
│  │  │  ├─ config/    chains.ts · constants.ts · clients.ts · abi.ts (GENERATED)
│  │  │  ├─ request/   create.ts · sign.ts · url.ts
│  │  │  ├─ verify/    ens.ts · verify-request.ts
│  │  │  ├─ payment/   permit.ts · pay.ts · watch.ts
│  │  │  ├─ wallet/    balances.ts
│  │  │  └─ testing/   index.ts         # exported as "@tap/core/testing"
│  │  └─ test/                          # mirrors src/
│  └─ react-native/                     # @tap/react-native: NFC transport + hooks (docs/06)
│     ├─ src/
│     │  ├─ index.ts · support.ts · errors.ts
│     │  ├─ merchant/  hce.ts · charge-machine.ts · useCharge.ts
│     │  └─ customer/  reader.ts · pay-machine.ts · useTapToPay.ts
│     └─ test/                          # state machines (pure, bun test)
│
├─ apps/                         # THINGS WE RUN
│  ├─ mobile/                           # customer wallet home + merchant tools (docs/07, D35)
│  │  ├─ app.config.ts · eas.json · metro.config.js · .env.example
│  │  ├─ plugins/withHce.js             # HCE service + aid_list.xml
│  │  ├─ app/                           # expo-router: one file = one screen
│  │  │  ├─ _layout.tsx · index.tsx · settings.tsx
│  │  │  ├─ merchant/  index.tsx · charge.tsx
│  │  │  └─ customer/  index.tsx · confirm.tsx
│  │  ├─ src/
│  │  │  ├─ components/                 # AmountPad, MerchantCard, StatusView, QrCode, QrScanner, SetupBanner, BalanceRow
│  │  │  ├─ wallet/    secure-key.ts · WalletProvider.tsx
│  │  │  ├─ copy.ts                     # every user-facing string
│  │  │  ├─ settings-store.ts
│  │  │  └─ theme.ts
│  │  └─ assets/
│  └─ server/                           # OPTIONAL (add-on A2), Hono on Bun. Absent until decided.
│
└─ scripts/                      # ONE-OFF CLI JOBS (bun run …)
   ├─ check-architecture.ts             # INV-12..16 + layering
   ├─ generate-abi.ts                   # forge artifacts → packages/core/src/config/abi.ts
   ├─ print-hash-vector.ts              # generates the digest for hash-vector.json (run once)
   ├─ setup-ens.ts                      # idempotent ENSv2 namespace setup (docs/04)
   ├─ register-merchant.ts              # issue <label>.tap.eth via the registrar
   ├─ check-ens.ts                      # P4: merchants resolve correctly
   └─ e2e.ts                            # P3: live sign → verify → pay → isPaid
```
**Rule of thumb:** `packages/` = what others install · `apps/` = what we run · `contracts/` = what lives onchain · `scripts/` = what we run once from a laptop · `docs/` = the plan.
**Dependency direction:** `apps/mobile → @tap/react-native → @tap/core`. Never upward.

## 6. Non-negotiables (details and enforcing tests: docs/09 §1)
1. **The tag is untrusted input.** Nothing from it is shown or used before `verifyRequest` returns `ok: true`.
2. Contract and token addresses, symbols and decimals come from `packages/core/src/config/chains.ts`, **never the tag**. That file is the only place addresses live in TS.
3. Merchant identity = live ENSv2 resolution + direct subname of `tap.eth`. **Never a hard-coded name→address map.**
4. Amounts are `bigint` end to end. No float maths.
5. `apps/mobile` never imports viem, ABIs or addresses. `@tap/core` never imports React Native or Expo.
6. The Pay button exists only when `state === "verified"`.
7. Never write records to the root name on our ENS resolver.
8. Private keys are never logged, committed or sent anywhere.
9. **No AI attribution in any commit or PR**: no `Co-Authored-By: Claude`, no "Generated with Claude Code", no `Claude-Session` trailer. The committer is the author.

## 7. How to work (every session)
**Start**
1. Read this file and the docs for your task (§2). Check §9 Status.
2. `git pull && bun install && bun run check`. If it's red on a clean checkout, fix or report that **before** new work.
3. Write down which protected flows (P1–P7, docs/09 §2) the task could affect.

**While working**
- Do only the task asked. **No drive-by refactors, renames, reformatting or dependency bumps.** If you notice something worth fixing, mention it; don't do it.
- Don't touch flows that already work unless the task is about them. If a change *must* touch a protected flow, say so up front and re-verify that flow before committing.
- Don't change 🔒 items, `types.ts`/`index.ts` exports, contract interfaces or the wire format without an agreed decision. Stop and propose instead.
- Stay inside your track's folders (§4).
- Use plan mode for anything touching more than 3 files or any 🔒 area.
- Ambiguous requirement? Ask. Don't guess.

**Commit: small, and often** (full protocol and template: docs/09 §4)
- **One logical change per commit, ≈ ≤ 150 changed lines** (excluding lockfiles/generated). Split anything bigger.
- Every commit passes `bun run check` and keeps every protected flow working. Tests ship in the same commit as the behaviour.
- Before committing: `git diff --stat`. Every file belongs to this change; revert strays.
- Message = `<type>(<scope>): <summary ≤72>` + **Why / What changed / What did NOT change / Verification** sections. Name exact files and functions. State which protected flows were re-checked.
- Never `--no-verify`. Never `.skip`/`.only`/`@ts-ignore`/`any` to get green. Never loosen a test or invariant to make it pass.

**End**
- Update §9 Status (tick only what's verified). Add a `docs/decisions.md` row for any decision. Summarise: what changed, what didn't, what's next, open risks.

## 8. Commands & environment
```bash
bun install
bun run hooks:install                 # once per clone
bun run check                         # the gate: arch · lint · typecheck · test · test:contracts · abi:check
bun run e2e                           # live P3 (needs funded .env)
bun run ens:setup | ens:register -- --label … --owner 0x… --display "…" | ens:check
cd contracts && forge test -vv
cd apps/mobile && bunx expo prebuild --clean && bunx expo run:android
cd apps/mobile && bunx eas build -p android --profile development
```
Root `.env` (never commit; testnet keys only):
```
BASE_SEPOLIA_RPC=
SEPOLIA_RPC=
DEPLOYER_PK=        # deploys TapPay (Base Sepolia ETH)
ENS_OWNER_PK=       # owns tap.eth, runs ENS setup + registrations (Sepolia ETH)
MERCHANT_PK=        # e2e merchant, owns e2e-merchant.tap.eth (signs only)
CUSTOMER_PK=        # e2e customer (Base Sepolia ETH + USDC)
```
`apps/mobile/.env`: `EXPO_PUBLIC_BASE_SEPOLIA_RPC=`, `EXPO_PUBLIC_SEPOLIA_RPC=`. The app generates its own key into secure-store.

## 9. Status
Tick only when the task's acceptance criteria in `docs/10-build-plan.md` pass. When a protected flow first passes, tick it too.

**Setup**
- [x] T0.1 Repo scaffold + stubs + gate + hooks + CI
- [x] T0.2 RPCs, EAS, phones, keys, funds

**SDK track**
- [x] S1 `tap.eth` registered (or `tappay.eth` + decision)
- [x] S2 `TapPay.sol` + tests + hash vector
- [x] S3 core request layer
- [x] S4 TapPay deployed → `chains.ts` + `abi.ts`
- [x] S5 core payment layer
- [x] S6 registrar + ENS setup + `e2e-merchant.tap.eth`
- [x] S7 core verification
- [x] S8 live e2e green
- [ ] S10 README + ENS write-up (demo video/GIF pending)

**Flow track**
- Entry productization (D35): customer home, durable onboarding/preferences, wallet recovery and explicit scanning implemented with Bun coverage. Physical-device P5/P6/P7 validation remains pending; this does not complete F3–F6/J1 acceptance.
- [x] F1 NFC spike passed (or QR plan adopted)
- [x] F2 `@tap/react-native`
- [ ] F3 app shell
- [ ] F4 merchant screens
- [ ] F5 customer screens + QR
- [ ] F6 failure paths + polish

**Joint**
- [ ] J1 real chain on real phones (`yoyogi-market.tap.eth` → merchant phone)
- [ ] J2 backup video recorded
- [ ] J3 submitted

**Protected flows** (once green, must stay green)
- [x] P1 contracts · [x] P2 core unit · [x] P3 live e2e · [ ] P4 live ENS · [ ] P5 NFC phones · [ ] P6 QR phones · [ ] P7 tamper blocked
