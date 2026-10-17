# Tap: the plan

Everything we decided before writing code. **Read the relevant docs before starting any task.** If code and a doc disagree, stop and ask; don't silently pick one.

## Reading order (first time)
1. `01-product.md`: what we're building and why
2. `02-architecture.md`: layers, payment sequence, trust and threat model
3. `09-quality-and-commits.md`: invariants, protected flows, commit rules (applies to everything)
4. `10-build-plan.md`: who does what, in which order
5. Then the docs for your track (below)

## Which doc for which work
| Working on | Read |
|---|---|
| `contracts/` | `03-contracts.md`, `09` |
| ENS setup, registrar, `scripts/*ens*` | `04-ens.md`, `03` (registrar), `09` |
| `packages/core/` | `05-sdk-core.md`, `02`, `09` |
| `packages/react-native/` | `06-sdk-react-native.md`, `08-nfc.md`, `09` |
| `apps/mobile/` | `07-mobile-app.md`, `06`, `08`, `09` |
| Demo, video, README, submission | `11-demo-and-submission.md` |
| Changing anything marked 🔒 | `decisions.md` first |

## Index
| Doc | Contents |
|---|---|
| [01-product.md](01-product.md) | Problem, solution, users, stories, scope, what's next |
| [02-architecture.md](02-architecture.md) | System diagram, layers, sequence, chains, trust + threat model, config, errors |
| [03-contracts.md](03-contracts.md) | TapPay + TapMerchantRegistrar: interface, reference code, tests, deploy |
| [04-ens.md](04-ens.md) | ENSv2 usage, namespace, Sepolia addresses, setup runbook, resolution |
| [05-sdk-core.md](05-sdk-core.md) | `@tap/core` layout, types, API, verify order, wire format, tests |
| [06-sdk-react-native.md](06-sdk-react-native.md) | `@tap/react-native` API and state machines |
| [07-mobile-app.md](07-mobile-app.md) | Screens, states, copy, wallet, build |
| [08-nfc.md](08-nfc.md) | HCE, reader, manifest plugin, spike, troubleshooting, QR fallback |
| [09-quality-and-commits.md](09-quality-and-commits.md) | Invariants, protected flows, gate, commit protocol, hooks, CI |
| [10-build-plan.md](10-build-plan.md) | Tasks with acceptance criteria, prompts, commit sequences; add-ons; risks |
| [11-demo-and-submission.md](11-demo-and-submission.md) | Pitch, demo script, video, Q&A, README outline, submission checklist |
| [decisions.md](decisions.md) | Append-only decisions log |
| [12-sponsorship-pilot.md](12-sponsorship-pilot.md) | Disabled direct-USDC sponsorship pilot, storage/budget boundaries and enablement gates |
| [13-wallet-delegation-plan.md](13-wallet-delegation-plan.md) | Completed planning-only delegation review, historical inspection facts, enforcement proofs and future approval gates |

## Keeping docs and code in sync
- A change to a 🔒 item updates **the doc, the code and `decisions.md` in the same commit**.
- Once code exists, `packages/*/src/types.ts` and `index.ts` must match `05`/`06` exactly. A mismatch is a bug in whichever one changed without the other.
- Addresses: docs describe *where* they live; the values live only in `packages/core/src/config/chains.ts` (and the ENS protocol table in `04`, used by scripts).
