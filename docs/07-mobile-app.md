# 07 · Mobile app (`apps/mobile`)

One Expo app with a customer wallet home and deliberate merchant-tools entry (D35 supersedes the demo role picker). It is **UI only**. Every chain, crypto, ENS or address concern goes through `@tap/core` / `@tap/react-native` (INV-14). Full visual design is deferred (decision D14). This doc fixes the **screens, states, behaviour and copy**, so the UI can be restyled later without touching logic.

## Folder layout
```
apps/mobile/
├─ package.json            # name "@tap/mobile" (private)
├─ app.config.ts           # name, android.package "xyz.tap.demo", plugins: ["./plugins/withHce.js"], NFC permission
├─ eas.json                # "development" profile: developmentClient true, android.buildType "apk"
├─ metro.config.js         # monorepo-aware (Expo's default getDefaultConfig handles workspaces; verify)
├─ .env.example            # EXPO_PUBLIC_BASE_SEPOLIA_RPC, EXPO_PUBLIC_SEPOLIA_RPC
├─ plugins/
│  └─ withHce.js           # Expo config plugin: HCE service + aid_list.xml (see 08-nfc.md)
├─ app/                    # expo-router: one file = one screen
│  ├─ _layout.tsx          # FIRST LINE: import "react-native-get-random-values"; then configureTap(); WalletProvider
│  ├─ +native-intent.tsx   # validated OS link → untrusted URL parameter for customer/confirm
│  ├─ index.tsx            # Customer wallet home (no scan on launch)
│  ├─ merchant/
│  │  ├─ index.tsx         # Amount entry (+ setup banner)
│  │  └─ charge.tsx        # Waiting for tap (NFC or QR) → Paid / Expired / Cancelled
│  ├─ customer/
│  │  ├─ index.tsx         # Explicit NFC/QR scan actions (+ balance)
│  │  └─ confirm.tsx       # Verifying → Verified / Unverified → Paying → Paid / Failed
│  └─ settings.tsx         # Wallet, merchant name, transport; development-only helpers
├─ src/
│  ├─ components/
│  │  ├─ AmountPad.tsx     # keypad → string input; parsing via parseAmountInput (core)
│  │  ├─ MerchantCard.tsx  # displayName / ensName ✓ / amount
│  │  ├─ StatusView.tsx    # full-screen state: pending | success | failure
│  │  ├─ QrCode.tsx        # QR fallback render
│  │  ├─ QrScanner.tsx     # QR fallback scan (expo-camera)
│  │  ├─ SetupBanner.tsx   # merchant ENS self-check result
│  │  └─ BalanceRow.tsx
│  ├─ copy.ts              # EVERY user-facing string + error-code → message map
│  ├─ wallet/
│  │  ├─ secure-key.ts     # load or create the device key in expo-secure-store
│  │  ├─ key-storage.ts    # Validates existing keys; replacement never deletes first
│  │  └─ WalletProvider.tsx# Account/address, loading, retryable errors
│  ├─ preferences.ts       # Versioned SecureStore persistence + ordered writes/recovery
│  ├─ settings-store.ts    # Persisted preferences; session-only development toggles
│  ├─ entry-state.ts       # Hydration/onboarding gate + back-or-home policy
│  ├─ read-session.ts      # Explicit read lifecycle; stale results ignored after blur/cancel
│  └─ theme.ts             # colours, spacing, type scale
└─ assets/
```

## Navigation
```
wallet + preferences hydration → first-run setup if not durably completed
index (customer home) ─┬─ Start a payment → customer/index → explicit NFC/QR → customer/confirm → home
                      ├─ Merchant tools → merchant/index → Charge → merchant/charge → merchant/index
                      └─ ⚙︎ → settings
incoming payment link → same hydration/setup gate → customer/confirm → home
```

Android may enter from a verified `https://tap-pay.xyz/p?...` App Link or an older
`NDEF_DISCOVERED` NFC dispatch. `+native-intent.tsx` accepts only that exact origin and path,
then passes the untouched URL to `customer/confirm`; the normal `useTapToPay` verification
still runs before any merchant or amount data is shown.

`Stack.screenLayout` wraps each route with `EntryGate`: route content cannot mount until storage
and wallet are ready. Setup does not redirect, so the pending URL remains in the navigator,
including across retryable storage failures. Nothing is decoded or displayed during setup.
Completion and cancellation dismiss payment routes to home; neither starts a new scan. Header
Back and Settings Close fall back to home when a direct launch has no back stack. A new URL on
an existing confirmation route mounts a fresh verification view instead of retaining an old result.

## Wallet
- On first launch, `secure-key.ts` generates a private key (`generatePrivateKey` from viem **via `@tap/core` re-export**, so the app never imports viem directly) and stores it in `expo-secure-store` under `tap.wallet.v1`.
- `WalletProvider` exposes account/address, loading, an error flag, and retry. Read, validation and write failures are caught; retry never silently replaces an existing key. The key is never logged or displayed.
- There is no login, cloud recovery, custody or account backend. The Hono server serves public pages and Android association; wallet actions use the SDK and RPC directly.
- The same device key signs merchant requests and pays customer requests. A configured merchant name is not proof that it resolves to this wallet; the live setup check and request verification remain authoritative.
- Development Settings → "Replace development wallet" warns that funds and names stay tied to the old key. A replacement overwrites only after successful generation/storage, without deleting first; failure retains the old account. Release Settings has no destructive wallet control.

## Preferences and first run
- Store version 1 preferences under `tap.preferences.v1` in the existing SecureStore: onboarding completion, NFC/QR preference and merchant name. Keep `tap.wallet.v1` separate and compatible with existing installs.
- First run explains testnets, device-key custody/recovery limitations and verification before confirmation, and offers NFC or QR preference. Existing wallets without preferences get setup without wallet replacement.
- Only a successful durable write grants completion. Writes are serialized; errors remain visible and retry saves the latest selection. Routine settings writes do not unmount active payment content.
- Read/corrupt/unsupported-version failures offer retry or an explicit preferences-only reset. Neither recovery action deletes the wallet. Development fake-chain/tamper state is never persisted and is forced off in release builds.

## Screens

### `index`: Customer home
- Testnet label, full copyable/selectable public address and SDK wallet balances, including loading/unavailable states and refresh. Faucet actions remain explicit.
- **Start a payment** opens the scan screen without starting NFC or requesting camera access.
- **Merchant tools** is a secondary action, with copy explaining that saving a name does not establish merchant verification. Settings remains accessible from the home header.

### `merchant/index`: Amount entry
- Header: merchant `displayName` (or `merchantName` until loaded), ⚙︎.
- `SetupBanner` runs `checkMerchantSetup(merchantName, address)` on focus:
  - ok → small green "yoyogi-market.tap.eth ✓"
  - not ok → yellow banner with copy for the reason and a "How to fix" link to merchant registration. **Charging is still allowed** (so we can demo the failure path).
- Large amount display `$0.00`, `AmountPad` (digits, `.`, backspace). Input is a string; `parseAmountInput` converts it. The app never does maths on amounts.
- **Charge $X.XX** button (disabled at 0). → `merchant/charge?amount=<base units string>`.

### `merchant/register`: Merchant onboarding
- Starts with the configured merchant label, validates it locally, then checks availability against `TapMerchantRegistrar` after a short debounce.
- Registers the device wallet as both owner and resolved address, waits for one Sepolia confirmation, and saves the resulting `*.tap.eth` name in app settings.
- Keeps the Sepolia faucet beside the registration wallet. Opening it copies the wallet address first; the private key never leaves the app.
- Offline fake chain disables registration visibly rather than pretending a live ENS name was issued.

### `merchant/charge`: Waiting / result
Driven entirely by `useCharge` state:
| State | UI |
|---|---|
| `preparing` | spinner "Preparing…" |
| `waiting` (nfc) | big amount, pulsing NFC icon, "Hold your phone out to the customer", countdown to expiry, **Cancel** |
| `waiting` (qr) | big amount, QR of `url`, countdown, **Cancel** |
| `paid` | full-screen green ✓, "Paid $5.00", short tx hash + "View on explorer", haptic success, **New charge** |
| `expired` | grey, "Request expired", **Try again** (same amount) |
| `cancelled` | back to amount entry |
| `error` | red, copy for the code, **Try again** |
If `demoTamper` is on, a small red "DEMO: tampered tag" chip is shown so it's never accidental.

### `customer/index`: Ready to tap
- Header: short address, ⚙︎. `BalanceRow`: "USDC $12.00 · Gas ✓/✗" via `getWalletBalances`.
- Warnings: no gas → "Add Base Sepolia ETH for gas"; USDC 0 → "Add USDC to pay".
- Zero-balance warnings include Base and Circle faucet links and copy the customer wallet address before opening them.
- **Read NFC request** starts a single read; focus/re-focus alone never starts one. Show "Hold near the merchant's phone" only while actually reading; allow cancel and retry. **Scan QR code** explicitly opens `QrScanner`; the preferred method has primary button styling.
- Blur/cancel/QR switching invalidates late NFC results before native cleanup. When a URL arrives, replace the scan route with `customer/confirm`; all URLs remain untrusted input.

### `customer/confirm`: Verify and pay
The verified view has a `USDC / ETH` segmented control. USDC remains the default and follows the
original permit path. Selecting ETH requests an exact-output quote, displays the maximum ETH
input, and keeps Pay disabled until the bounded quote is ready. Quote failure leaves the verified
request active so the customer can return to direct USDC.

Driven by `useTapToPay` state:
| State | UI |
|---|---|
| `verifying` | spinner "Checking merchant…" |
| `verified` | `MerchantCard`: **displayName** (large), **ensName ✓** (green), **$5.00**, "Expires in 1:42". Button **Pay $5.00** |
| `rejected` | red shield, **"Unverified merchant"**, reason copy, **no Pay button**, **Done** |
| `paying` | amount + "Paying…" pending state |
| `paid` | full-screen green ✓ "Paid Takoyaki Stand $5.00", haptic, **Done** |
| `failed` | red, copy for `TapPayError.code`, **Done** |
The Pay button is rendered **only** when `state === "verified" && verify.ok` (INV-17). There is no other code path to `confirm()`.

### `settings`
- **Wallet:** full address (copy button), balances with refresh, and honest on-device custody information from setup.
- **Merchant:** ENS name field (default `yoyogi-market.tap.eth`) plus a self-service registration entry point. Manual name editing remains available.
- **Transport:** NFC / QR toggle.
- **Development only (`__DEV__`):** wallet replacement, tampered-tag fields m/n/t/a/x/k/c (default off), and "Offline fake chain" (default off; `createFakeCore()`). Copy states that simulated balances, verification and payment results are not real evidence. A visible "DEVELOPMENT ONLY · FAKE CHAIN" chip remains on screen while active. Release builds cannot enable these helpers; physical tamper smoke requires a development build.
- **About:** app version, chain IDs, TapPay address (read from core, display only).

## Copy (`src/copy.ts`): every user-facing string lives here
| Code / situation | Message |
|---|---|
| verified | "{displayName}" · "{ensName} ✓" |
| `malformed` | "This isn't a valid Tap payment request." |
| `unknown_chain` / `unknown_token` | "This request uses a network or token Tap doesn't support." |
| `expired` | "This payment request has expired. Ask the merchant to try again." |
| `bad_signature` | "The request wasn't signed by this merchant. It may have been tampered with." |
| `not_under_parent` | "This merchant isn't registered on tap.eth." |
| `ens_unresolved` | "This merchant name isn't registered." |
| `ens_mismatch` | "This merchant name belongs to someone else." |
| `network_error` | "Couldn't check the merchant. Check your connection and try again." |
| `insufficient_funds` | "Not enough USDC to pay." |
| `insufficient_gas` | "Not enough Base Sepolia ETH for gas." |
| `already_paid` | "This request has already been paid." |
| `nfc_disabled` | "Turn on NFC in your phone's settings." |
| `nfc_unsupported` | "This phone doesn't support NFC. Use QR instead." |
| `read_timeout` | "No tap detected. Try again." |
| fallback | "Something went wrong. Try again." |
Error codes never appear on screen. Unknown codes use the fallback.

## UX rules
- Amounts are huge and centred; the merchant name is the second-largest thing on the customer screen.
- Green means paid onchain, never before. "Pending" is neutral grey/blue.
- Haptic on tap detected, on paid, on rejected.
- Keep the screen awake on `merchant/charge` (`expo-keep-awake`); HCE needs the screen on.

## Build & run
### Entry acceptance (Bun and phones)
`bun test apps/mobile/test` covers preference persistence/recovery, key retention on failures,
hydration/onboarding gating, pending cold-link retention through retry, warm-link routing,
safe back fallback, opt-in reads, duplicate starts and stale read cancellation. The gate test
uses mocked native storage/rendering; it does not establish Expo/Android behavior.

Before accepting the mobile release, use two phones: fresh setup → relaunch retains preference
and address; locked/unavailable storage retry; direct settings/merchant Back; cold/warm payment
links before/after setup; no scan on launch/refocus/Done; NFC cancel and QR switching; then P5,
P6 and P7 with a development build (fake chain off). These checks remain **not validated** in
the terminal implementation session; no payment or merchant claim follows from Bun results.

```bash
cd apps/mobile
cp .env.example .env                        # fill RPC URLs
bunx expo prebuild --clean                  # generates android/ with the withHce plugin applied
bunx expo run:android                       # local build to a USB-connected phone
# or cloud build:
bunx eas build -p android --profile development    # APK to install on both phones
bunx expo start --dev-client                # JS reload without rebuilding
```
Rebuild native (prebuild + run/EAS) only when native config changes: plugins, native deps, `app.config.ts`. JS changes hot-reload.
`android/` is generated. It's gitignored and never hand-edited.
