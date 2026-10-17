# 01 · Product

## One-liner
**Turn any phone into a payment terminal for Japan's cash-only merchants, with ENS as the answer to "who am I actually paying?"**

## The problem
- Tokyo festival stalls, flea markets, izakaya counters and shrine stands take **cash or Suica only**.
- Tourists without cash or a Suica card can't pay. Vendors won't buy a card terminal for a weekend stall.
- Crypto's current answer is "scan this QR and trust this hex address". That's the scariest moment in the flow, and **swapped-QR scams are real**: a sticker over the vendor's QR sends the money to a thief, and the customer can't tell.

## The solution
A two-sided **SDK** plus a demo app:
- **Charge side** (merchant / POS apps): enter an amount, hold out the phone. The phone broadcasts a **signed payment request** over NFC.
- **Tap-to-pay side** (wallets): tap the merchant's phone, read the request, **verify the merchant against ENS**, show a human-readable name, pay with one confirm.

What the customer sees before confirming:

```
┌──────────────────────────────┐
│  Takoyaki Stand              │   ← display name from the ENS text record "name"
│  yoyogi-market.tap.eth  ✓    │   ← verified ENS subname of tap.eth
│                              │
│          $5.00               │   ← amount from the signed request
│                              │
│      [   Pay $5.00   ]       │
└──────────────────────────────┘
```

If anything doesn't check out (tampered tag, foreign name, expired request), the customer sees **"Unverified merchant"**, the reason in plain words, and no pay button.

## Why ENS is load-bearing, not cosmetic
Without ENS, the customer only sees an address and has to trust the tag. With ENS:
1. The merchant signs the request with the key behind their address.
2. The request names the merchant (`yoyogi-market.tap.eth`).
3. The wallet resolves that name **live on ENSv2** and checks it points to the signer.
4. The name must be a direct subname of **`tap.eth`**. Subnames of `tap.eth` are only issued through **our registrar contract** on our own ENSv2 subname registry, so a scammer's `yoyogi-market.eth` is rejected.
5. The display name ("Takoyaki Stand") comes from the **ENS text record**, never from the tag.

A swapped or tampered tag fails at least one of these checks. That's the killer demo beat.

## Users
| User | Wants | Gets |
|---|---|---|
| **Vendor** (stall, market, counter) | Take payments without buying hardware | Their existing Android phone is the terminal |
| **Customer** (tourist, crypto user) | Pay without cash and without fear of scams | A verified merchant name before paying; tap, confirm, done |
| **Wallet developer** | Add tap-to-pay | `@tap/core` + the customer half of `@tap/react-native` |
| **POS / merchant-app developer** | Add NFC charging | `@tap/core` + the merchant half of `@tap/react-native` |

## User stories (core loop)
- **M1:** As a vendor, I enter $5.00 and my phone waits for a tap.
- **M2:** As a vendor, my screen turns green within seconds of the customer paying, so I can hand over the food.
- **M3:** As a vendor, I can cancel a charge. An unpaid charge expires on its own after 2 minutes.
- **M4:** As a vendor, I can see whether my ENS name is set up correctly before I start taking payments.
- **C1:** As a customer, I tap the vendor's phone and immediately see who I'm paying and how much.
- **C2:** As a customer, I'm blocked from paying a merchant who can't be verified, and told why in plain words.
- **C3:** As a customer, I confirm once and see it go through.
- **C4:** As a customer, I can see my wallet address and balance so I know I can pay.

## Scope
**In (core loop, must ship):**
- Android merchant broadcasting a signed request over HCE
- Android customer reading, verifying against ENSv2, paying USDC on Base Sepolia with permit (one tx)
- Merchant confirmation via the onchain `Paid` event
- Tampered-tag rejection
- QR fallback transport
- Merchant namespace `tap.eth` on ENSv2 Sepolia: our own UserRegistry, our `TapMerchantRegistrar` contract with EAC roles, and the demo merchant issued through it

**Add-ons** (only after the core loop works; priority order is in `10-build-plan.md`).

**Out (explicitly not doing):**
- iOS merchant (needs Apple's HCE entitlement)
- Offline stored value (true Suica)
- Fiat on/off-ramp
- Mainnet deployment
- Token swaps (Uniswap) unless a decision re-adds them
- Native Kotlin/Swift SDKs (post-hackathon)
- A backend server (only if a decision adds `apps/server`)

## What makes it an SDK (the judging claim)
- `@tap/core` is pure TypeScript with zero React Native imports. It runs in Node/Bun (e2e script), in the app, and later on the web.
- `@tap/react-native` only moves bytes over NFC. Swapping NFC for QR costs almost nothing.
- The app ships **both SDK halves**, with a customer wallet home and deliberate merchant-tools entry (D35).

## Success criteria
1. Live demo at the ENS booth: tap → verified name → paid → merchant green, in under 10 seconds.
2. Tampered tag blocked live.
3. Public repo, README pointing at the exact ENS verification lines, 2–4 min video.
4. `bun run check` and `bun run e2e` green on `main`.

## What's next (pitch closer)
- **Spending limits / session keys:** pre-approved small payments without a confirm, the true Suica feel
- **Key rotation:** a `tap.signer` text record managed through ENSv2 Enhanced Access Control, so the signing key on the phone can rotate while payouts stay on a cold wallet
- **Anti-squatting:** gate subname registration behind proof of personhood (e.g. World ID): one verified human per merchant name
- **iPhone as customer** (iPhones can read NFC tags), native Kotlin/Swift SDKs, gas sponsorship via a paymaster
