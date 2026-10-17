# 11 · Demo and submission

**Deadline: Sun 2026-09-27 09:00 JST.** Submit early (target Sun 07:00), then improve if time allows.

## 60-second booth pitch
1. **Problem (10s):** "Half of Tokyo's food stalls and markets are cash-only. Tourists can't pay, and vendors won't buy a terminal. Crypto's answer is 'scan my QR and trust this hex address', which is exactly how swapped-QR scams work."
2. **Demo (30s):** vendor types $5, holds out the phone. Tap. "Takoyaki Stand · yoyogi-market.tap.eth ✓ · $5.00." Pay. Both phones green.
3. **The ENS beat (15s):** flip on the tampered tag. Tap. "Unverified merchant." "The name is resolved live on ENSv2 and must be a subname of tap.eth, issued by our registrar on our own UserRegistry with EAC roles. A tampered or foreign tag can't pass."
4. **Close (5s):** "It's an SDK: wallets add tap-to-pay, POS apps add charging. Next: spending limits for a true Suica feel."

## Live demo script (booth)
For the Uniswap version of the payment beat, select **ETH**, pause on the displayed maximum, then
pay. Say: "The vendor still prices and receives exact USDC; Uniswap lets the customer pay with
ETH." Keep USDC as the fallback path for the protected baseline demo.

| Step | Merchant phone | Customer phone | Say |
|---|---|---|---|
| 0 | Home → Merchant tools: live setup check ✓ | Complete first-run setup; home balance visible | "Two ordinary Android phones." |
| 1 | Enter 5 → Charge | Start a payment → Read NFC request | "The vendor signs a payment request and broadcasts it over NFC." |
| 2 | Waiting | Tap → verified card | "Before paying, the wallet checks ENS: who signed it, which name, is it under tap.eth." |
| 3 | — | Pay | "One transaction on Base, with a USDC permit." |
| 4 | Green ✓ | Green ✓ | "The vendor saw the onchain Paid event for this exact request." |
| 5 | Development-only Settings → tamper amount → new charge | Home → Start a payment → Read NFC request → Tap → Unverified | "Change one byte and it's blocked." |
| 6 | — | — | Show the README ENS table / registrar code if they want depth |

Checklist before every run: both phones charged and unlocked, NFC on, keep-awake on, **fake chain OFF, tamper OFF**, customer funded, `bun run ens:check` ✓ earlier that hour, backup video ready on a laptop.
Use a development build for the tamper control; it is absent from release Settings (D35).

## Demo video (2–4 min)
| Time | Shot | Voice-over |
|---|---|---|
| 0:00–0:20 | Stall footage/photo, "cash only" sign | The problem |
| 0:20–0:40 | Swapped-QR illustration | Why "trust this address" fails |
| 0:40–1:40 | Screen-record both phones (split screen): charge → tap → verified → pay → green | The flow |
| 1:40–2:10 | Tampered tag → "Unverified merchant" | ENS as the trust root |
| 2:10–2:50 | Diagram from `02-architecture.md` + ENS namespace from `04-ens.md` | How it works: SDK layers, ENSv2 registry/registrar/EAC, TapPay |
| 2:50–3:20 | Code: `verifyRequest` order, `TapMerchantRegistrar.register` | "It's an SDK" |
| 3:20–3:40 | What's next | Spending limits, key rotation via EAC, iPhone, anti-squatting |
Record with the real chain (no fake core). Keep the explorer tab of the `Paid` tx ready for a cut-in.

## Judge Q&A prep
| Question | Answer |
|---|---|
| Why not just a QR with an address? | The address is exactly what gets swapped. We verify a signature + an ENS name issued under a namespace we control. |
| Why ENS and not a merchant allowlist? | Live, open, composable identity: any wallet can verify without asking us. ENSv2 lets us run our own registry and registrar with least-privilege EAC roles. |
| Who can get a `tap.eth` name? | Anyone, free, via the registrar (hackathon). Squatting is a known gap. Next: proof-of-personhood gating. |
| What if the merchant's phone is stolen? | Today: the key is on the phone. Next: a `tap.signer` record so the signing key rotates via EAC while payouts stay on a cold wallet. |
| Isn't this slower than Suica? | Suica is offline stored value. We're ~3s on an L2. Spending limits/session keys remove the confirm for small amounts. |
| Why Android only? | iOS apps can't emulate NFC cards without Apple's entitlement. iPhones can *read*, so an iPhone customer is next. |
| Replay / tampering? | Per-merchant nonce onchain, 2-min expiry, EIP-712 domain bound to chain + contract, every field signed. |
| What's onchain vs off? | Request signing and verification are offchain (free); settlement + `Paid` event are onchain; merchant identity is ENS on Sepolia. |

## README outline (the judges read this)
1. **Tap**: one-liner + 20-second GIF
2. **The problem** (3 bullets)
3. **How it works**: sequence diagram (from `02`)
4. **Why ENS is central**: the table from `04-ens.md` with **links to exact lines** in `verify-request.ts`, `ens.ts`, `TapMerchantRegistrar.sol`, `setup-ens.ts`
5. **Architecture**: SDK layers table, repo map
6. **Deployed**: TapPay (Base Sepolia), `tap.eth` UserRegistry, resolver, TapMerchantRegistrar, demo merchant registration tx (all as explorer links)
7. **Run it**: `bun install`, `bun run check`, `bun run e2e`, build the APK
8. **Security model**: the threat table from `02` (short)
9. **Trade-offs**: managed namespace, resolver-wide registrar roles, free registration
10. **What's next**
11. **Demo video** link, **APK** download (GitHub release)

## Submission checklist
- [ ] Submit [`FEEDBACK.md`](../FEEDBACK.md) at https://developers.uniswap.org/hackathon-feedback using the team's contact details.
- [ ] Repo is **public**, README complete, `main` green (CI badge)
- [x] APK attached to a GitHub release (the "live demo link"; plus the web verifier if A2 shipped)
- [ ] Demo video uploaded (2–4 min) and linked
- [ ] ENS requirements: ENSv2 on Sepolia ✓, features central ✓, no hard-coded values ✓, live demo link ✓, open source ✓
- [ ] Partner prizes selected (max 3; a multi-track partner counts once): **ENS: Best Use of ENSv2**. Add another partner only if an add-on genuinely integrates it (e.g. Uniswap via A8, which also needs `FEEDBACK.md` + the feedback form at https://developers.uniswap.org/hackathon-feedback)
- [ ] Contract addresses and tx links in the form
- [ ] Both team members listed
- [ ] Submitted before **09:00 JST Sun 2026-09-27**; confirmation screenshot saved
- [ ] Booth judging: phones charged, chargers, backup video on a laptop, pitch rehearsed
