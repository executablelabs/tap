# 07 · Mobile app (`apps/mobile`)

The demo app: one Expo **dev build** with both halves of the SDK behind a role picker. It is **UI only**. Every chain, crypto, ENS or address concern goes through `@tap/core` / `@tap/react-native` (INV-14). Full visual design is deferred (decision D14). This doc fixes the **screens, states, behaviour and copy**, so the UI can be restyled later without touching logic.

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
│  ├─ index.tsx            # Role picker
│  ├─ merchant/
│  │  ├─ index.tsx         # Amount entry (+ setup banner)
│  │  └─ charge.tsx        # Waiting for tap (NFC or QR) → Paid / Expired / Cancelled
│  ├─ customer/
│  │  ├─ index.tsx         # Ready to tap (+ balance)
│  │  └─ confirm.tsx       # Verifying → Verified / Unverified → Paying → Paid / Failed
│  └─ settings.tsx         # Wallet, merchant name, transport, demo toggles
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
│  │  └─ WalletProvider.tsx# React context: { account, address }
│  ├─ settings-store.ts    # role, merchantName, transport, demoTamper
│  └─ theme.ts             # colours, spacing, type scale
└─ assets/
```

## Navigation
```
index (role picker) ─┬─ "I'm selling" ─► merchant/index ──Charge──► merchant/charge ──Done──► merchant/index
                     ├─ "I'm paying"  ─► customer/index ──tap──►  customer/confirm ──Done──► customer/index
                     └─ ⚙︎ ─► settings (reachable from every screen header)
```

Android may enter from a verified `https://tap-pay.xyz/p?...` App Link or an older
`NDEF_DISCOVERED` NFC dispatch. `+native-intent.tsx` accepts only that exact origin and path,
then passes the untouched URL to `customer/confirm`; the normal `useTapToPay` verification
still runs before any merchant or amount data is shown.

## Wallet
- On first launch, `secure-key.ts` generates a private key (`generatePrivateKey` from viem **via `@tap/core` re-export**, so the app never imports viem directly) and stores it in `expo-secure-store` under `tap.wallet.v1`.
- `WalletProvider` exposes `{ account: LocalAccount, address }`. The key never leaves secure storage except in memory, and is never logged or displayed.
- The same device key is used as merchant signer or customer payer depending on role. For the demo, the merchant phone's address is registered as `yoyogi-market.tap.eth`.
- Settings → "Reset wallet" warns that funds and registered names remain tied to the old key before deleting and regenerating it.

## Screens

### `index`: Role picker
- Title "Tap", subtitle "Pay and get paid with a tap".
- Two large buttons: **"I'm selling"** (merchant) and **"I'm paying"** (customer). The last choice is remembered.
- If `getNfcSupport().canEmulate` is false, the merchant button shows "NFC card emulation not available. QR only".

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
- **Wallet:** full address (copy button), balances, "Reset wallet" (demo, confirm dialog).
- **Merchant:** ENS name field (default `yoyogi-market.tap.eth`) plus a self-service registration entry point. Manual name editing remains available.
- **Transport:** NFC / QR toggle.
- **Demo:** "Serve tampered tag" (field picker m/n/t/a/x/k/c; default off), with a warning that it's for the failure demo.
- **Developer:** "Offline fake chain" (default off; uses `createFakeCore()` so screens work before the chain code lands). A visible "FAKE CHAIN" chip appears on every screen while it's on. Removed from the UI before recording the demo.
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
