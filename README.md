# Tap

Tap turns two ordinary Android phones into a crypto point of sale: the merchant enters an
amount, the customer taps, the wallet verifies the merchant through ENSv2, and USDC settles on
Base Sepolia.

[![check](https://github.com/gitaugakwa/tap/actions/workflows/check.yml/badge.svg)](https://github.com/gitaugakwa/tap/actions/workflows/check.yml)

Built for ETHGlobal Tokyo 2026.

**[Download the Android APK](https://github.com/gitaugakwa/tap/releases/download/v0.0.1/tap-android.apk)**
· [Release notes](https://github.com/gitaugakwa/tap/releases/tag/v0.0.1)
· Demo video coming after final two-phone integration

## The problem

- Small merchants should not need dedicated payment hardware.
- A QR code containing a wallet address can be replaced without the customer noticing.
- Raw addresses do not tell a customer who will receive their money.

Tap signs every payment request, transports it over NFC or QR, and resolves the merchant's
name live under the managed `tap.eth` namespace before enabling payment. Removing ENS removes
the product's identity and anti-substitution guarantee.

## How it works

```text
Merchant phone                     Customer phone                     Chains
     |                                    |                              |
     | Sign EIP-712 payment request       |                              |
     | Serve URL over NFC or QR ---------->                              |
     |                                    | Verify signature             |
     |                                    | Resolve *.tap.eth ----------> Sepolia ENSv2
     |                                    | Check name -> signer          |
     |                                    | Confirm USDC or ETH ----------> Base Sepolia
     |                                    | ETH: exact-output Uniswap     |
     | <------------------------ Paid event for merchant + nonce -------- TapPay
     | Both phones show paid             |                              |
```

Each request binds the merchant, token, amount, nonce, expiry, merchant ENS name, chain, and
TapPay contract into one EIP-712 signature. `TapPay` rejects expired, altered, and replayed
requests and emits a `Paid` event tied to the exact merchant nonce.

The customer can keep the direct USDC permit path or select ETH. ETH is quoted as exact-output
USDC through Uniswap v3, capped before confirmation, swapped by `TapSwapPay`, and then settled
through the same `TapPay` request. The merchant always receives the signed USDC amount.

### Uniswap integration

Tap uses QuoterV2 to compare direct and WETH-bridged Uniswap v3 routes, then displays a bounded
maximum input before payment. `TapSwapPay` calls SwapRouter02 `exactOutput`, sends the exact signed
USDC amount through `TapPay`, and atomically refunds unused ETH. Direct USDC payments remain the
default path and do not touch Uniswap.

Relevant implementation and evidence:

- [`TapSwapPay` exact-output settlement, refund, and route validation](contracts/src/TapSwapPay.sol#L52-L141)
- [SDK route discovery, quoting, slippage cap, and payment](packages/core/src/payment/swap.ts#L55-L316)
- [Customer ETH selection and maximum-input confirmation](apps/mobile/app/customer/confirm.tsx#L51-L120)
- [Solidity adapter tests](contracts/test/TapSwapPay.t.sol#L67-L245) and [SDK swap tests](packages/core/test/payment/swap.test.ts#L51-L216)
- [Funded live exact-output test](scripts/e2e-swap.ts#L72-L139) and [`FEEDBACK.md`](FEEDBACK.md)
- [Base Sepolia payment transaction](https://sepolia.basescan.org/tx/0x1cfd4e9ea0fb449711c771cda22da566bc7d32180c95d9423ec1a61351caabfa)

## Why ENSv2 is central

| ENSv2 feature | Tap usage | What breaks without it |
|---|---|---|
| Hierarchical registry | `tap.eth` owns a dedicated UserRegistry containing merchant subnames | There is no trusted merchant namespace |
| Custom registrar | `TapMerchantRegistrar` binds each direct subname to its owner when issuing it | Merchant names are not reliably bound to payout keys |
| Enhanced Access Control | The registrar receives only the registry and resolver roles needed for issuance | Registration requires an over-privileged operator |
| Permissioned Resolver | Stores the merchant address and human-readable display name | The wallet cannot obtain trusted merchant metadata |
| Universal Resolver | Every tap resolves the merchant live through the public ENS path | Verification becomes a closed, hard-coded allowlist |

Relevant implementation:

- [`TapMerchantRegistrar.register`](contracts/src/TapMerchantRegistrar.sol#L68-L94)
- [ENS merchant resolution](packages/core/src/verify/ens.ts#L17-L70)
- [Ordered request verification](packages/core/src/verify/verify-request.ts#L70-L105)
- [Idempotent ENS setup and EAC grants](scripts/setup-ens.ts#L236-L278)
- [Live ENS check](scripts/check-ens.ts#L12-L56)
- [Funded end-to-end payment](scripts/e2e.ts#L74-L133)

## Architecture

| Layer | Package | Responsibility |
|---|---|---|
| Demo application | `apps/mobile` | Wallet UX, merchant/customer screens, QR fallback, settings |
| Native SDK | `@tap/react-native` | NFC HCE, reader mode, charge/payment state machines |
| Core SDK | `@tap/core` | Requests, signatures, ENS verification, payment, configuration |
| Contracts | `contracts` | Replay-safe settlement and permissionless merchant registration |

Dependencies only point downward:

```text
apps/mobile -> @tap/react-native -> @tap/core
                                  -> TapPay / ENSv2
```

The mobile app contains no ABIs, deployed addresses, or direct `viem` dependency. All deployed
configuration lives in [`packages/core/src/config/chains.ts`](packages/core/src/config/chains.ts).

## Deployed contracts

| Component | Network | Address |
|---|---|---|
| TapPay | Base Sepolia | [`0x4c679b2dE8AE517fF12AA34A1bE0F81913678792`](https://sepolia.basescan.org/address/0x4c679b2dE8AE517fF12AA34A1bE0F81913678792) |
| TapSwapPay | Base Sepolia | [`0xA36df4D6DA08bA1FbE89ddEB7229218FAf0BF84d`](https://sepolia.basescan.org/address/0xA36df4D6DA08bA1FbE89ddEB7229218FAf0BF84d) |
| `tap.eth` UserRegistry | Sepolia | [`0x6A2Cad68E45E1A5D5DF62D8deF294455c2360D78`](https://sepolia.etherscan.io/address/0x6A2Cad68E45E1A5D5DF62D8deF294455c2360D78) |
| Permissioned Resolver | Sepolia | [`0x7F7c02793854B68B8fa5776EB768cbac5966AdCA`](https://sepolia.etherscan.io/address/0x7F7c02793854B68B8fa5776EB768cbac5966AdCA) |
| TapMerchantRegistrar | Sepolia | [`0xcF7F9f2f0a9a471B1E2D6c4F0D1a59563821B759`](https://sepolia.etherscan.io/address/0xcF7F9f2f0a9a471B1E2D6c4F0D1a59563821B759) |

TapPay deployment transaction:
[`0x5139...69d2`](https://sepolia.basescan.org/tx/0x5139eadb16cae193bca62c9d9f0098927b826742bfbc7014a84b3e79c93769d2).
TapSwapPay deployment transaction:
[`0x34b2...58d3`](https://sepolia.basescan.org/tx/0x34b2e25bf8728c74d02971d1b76cded41e37b7bcad95814afb4e89fd01ae58d3).
`tap.eth` registration transaction:
[`0xfb57...6e01`](https://sepolia.etherscan.io/tx/0xfb579015b58b4535774e189c402e55681cb59a1241d808395b13c10166c16e01).
`e2e-merchant.tap.eth` registration transaction:
[`0x14d3...3b13`](https://sepolia.etherscan.io/tx/0x14d3922a4a5404c587a7abc045035eb77560fdb0e4b3c180e047e43e957e3b13).
Latest protected P3 payment:
[`0x34c1...bb22`](https://sepolia.basescan.org/tx/0x34c1e11c324500015ba4bca9b21ed90c9c33e1c1051375567df1a580895bbb22).
Latest exact-output Uniswap payment:
[`0x1cfd...abfa`](https://sepolia.basescan.org/tx/0x1cfd4e9ea0fb449711c771cda22da566bc7d32180c95d9423ec1a61351caabfa).

`e2e-merchant.tap.eth` resolves publicly to the configured test merchant and carries the text
record `name = E2E Test Merchant`. The merchant can register a phone-owned `*.tap.eth` name from
the app; the flow binds it to that phone's wallet and waits for Sepolia confirmation.

## Run the checks

Requirements: Bun 1.4.2 and Foundry.

```bash
bun install --frozen-lockfile
bun run check
```

The gate runs architecture enforcement, formatting/linting, TypeScript checks, SDK tests,
Foundry tests, and generated-ABI drift detection.

For the live SDK path, create `.env` from [`.env.example`](.env.example), configure both RPC URLs
and the four test keys, then fund the customer with Base Sepolia ETH and USDC.

```bash
bun run e2e
bun run e2e:swap
```

This submits a real `$0.01` USDC payment. It checks live ENS resolution, signature and URL
roundtrip, tamper rejection, SDK/contract hash parity, settlement, `isPaid`, and replay rejection.
`e2e:swap` pays the same exact USDC output with native ETH and additionally checks the displayed
input cap, `SwapPaid` customer attribution, merchant balance delta, and original `Paid` event.
After registering the merchant phone during J1, `bun run ens:check` verifies both demo names and
their display records through the public ENS path.

## Run the Android demo

The app requires an Expo development build because NFC HCE is native functionality.

```bash
cd apps/mobile
cp .env.example .env
bunx expo prebuild --clean --platform android
bunx expo run:android
bunx expo start --dev-client
```

The merchant phone serves a signed URL using Android HCE. The customer phone reads it using
reader mode. QR transport exercises the same signed payload and verification path when NFC is
unavailable.

The current app source opens a customer wallet home after first-run setup, with explicit scan
actions and a secondary **Merchant tools** entry. Wallet keys and onboarding/preferences use
device secure storage; there is no login or cloud recovery. Payments remain testnet-only.
Development builds visibly label fake-chain/tamper helpers; those controls are unavailable in
release builds. See [mobile behavior and device acceptance](docs/07-mobile-app.md). Existing
downloadable APKs do not acquire these source changes until a new build is published.

The source also includes a **disabled sponsorship-only pilot**: a separate customer
account preview, exact USDC approval/payment operations, authenticated sponsor
policy/ledger code, and restart-safe pending coordination. Public sponsorship is
unavailable; there is no live provider adapter or sponsored Pay option. Mocked
protocol and contract-fixture tests are not live compatibility evidence. See
[pilot scope, operator settings and enablement gates](docs/12-sponsorship-pilot.md).

The downloadable `v0.0.1` APK is a signed EAS build for package `xyz.tap.demo`; its archive and
configuration checks passed, and its SHA-256 digest is
`983f1edf9b2c800ce53c54cbfb20e50083653a4bff7b56f47cc445dbdcaaea2e`. NFC transport was
separately validated on a Samsung Galaxy S23 and Galaxy A56 5G, both running Android 16.

## Security model

| Threat | Defense |
|---|---|
| Swapped NFC tag or QR code | Every request field is signed; the customer resolves the signed ENS name live |
| Foreign or nested ENS name | Only valid direct children of `tap.eth` are accepted |
| Merchant-name substitution | The ENS address must equal the request signer and payout address |
| Replay | `TapPay` stores used nonces per merchant |
| Stale request | SDK and contract both enforce the two-minute expiry |
| Wrong network, token, or contract | Explicit allowlists and EIP-712 domain binding |
| RPC failure | Verification fails closed; network failure is never treated as verified |
| Permit front-running | Settlement tolerates a consumed permit only when sufficient allowance already exists |

See [the full threat model](docs/02-architecture.md) and
[enforced invariants](docs/09-quality-and-commits.md).

## Trade-offs

- `tap.eth` is a managed namespace. The registrar is permissionless and first-come for the
  hackathon; production needs anti-squatting controls.
- Resolver write roles are record-type scoped but not merchant-name scoped. The registrar has no
  write path except the name it is registering.
- Merchant keys currently live in secure storage on the phone. A production version should use
  an ENS signer record or smart account so payout ownership and signing authority can rotate
  independently.
- Android merchants can emulate NFC cards. iPhone merchant support requires a different transport;
  iPhone customer reading is a natural next step.

## What's next

- Spending limits or session keys for low-value payments without a confirmation tap
- Rotatable `tap.signer` records using ENSv2 EAC delegation
- Anti-squatting controls for permissionless merchant onboarding
- iPhone customer support
- Production networks and independently managed merchant resolvers

Detailed design and build decisions live in [`docs/`](docs/README.md).
