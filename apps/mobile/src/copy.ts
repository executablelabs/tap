export type CopyErrorCode =
  | "malformed"
  | "unknown_chain"
  | "unknown_token"
  | "expired"
  | "bad_signature"
  | "not_under_parent"
  | "ens_unresolved"
  | "ens_mismatch"
  | "network_error"
  | "network"
  | "insufficient_funds"
  | "insufficient_gas"
  | "already_paid"
  | "nfc_disabled"
  | "nfc_unsupported"
  | "read_timeout"
  | "hce_unsupported"
  | "charge_in_progress"
  | "transport_unknown"
  | "payment_reverted"
  | "no_route"
  | "invalid_quote"
  | "invalid_slippage"
  | "invalid_token"
  | "invalid_label"
  | "invalid_display_name"
  | "owner_mismatch"
  | "name_taken"
  | "registration_reverted"
  | "registration_insufficient_gas"
  | "registration_network"
  | "registration_failed"
  | "fallback";

const errorMessages: Record<CopyErrorCode, string> = {
  malformed: "This isn't a valid Tap payment request.",
  unknown_chain: "This request uses a network or token Tap doesn't support.",
  unknown_token: "This request uses a network or token Tap doesn't support.",
  expired: "This payment request has expired. Ask the merchant to try again.",
  bad_signature: "The request wasn't signed by this merchant. It may have been tampered with.",
  not_under_parent: "This merchant isn't registered on tap.eth.",
  ens_unresolved: "This merchant name isn't registered.",
  ens_mismatch: "This merchant name belongs to someone else.",
  network_error: "Couldn't check the merchant. Check your connection and try again.",
  network: "Couldn't submit the payment. Check your connection and try again.",
  insufficient_funds: "Not enough USDC to pay.",
  insufficient_gas: "Not enough Base Sepolia ETH for gas.",
  already_paid: "This request has already been paid.",
  nfc_disabled: "Turn on NFC in your phone's settings.",
  nfc_unsupported: "This phone doesn't support NFC. Use QR instead.",
  read_timeout: "No tap detected. Try again.",
  hce_unsupported: "This phone can't serve NFC payments. Use QR instead.",
  charge_in_progress: "Another charge is already active.",
  transport_unknown: "Couldn't start this payment method. Use QR instead.",
  payment_reverted: "The payment was rejected onchain. No funds were moved.",
  no_route: "No Uniswap route is available for this payment.",
  invalid_quote: "This quote is no longer valid. Get a new quote and try again.",
  invalid_slippage: "The selected price tolerance isn't supported.",
  invalid_token: "This input token isn't supported for this payment.",
  invalid_label: "Use 3-32 lowercase letters, numbers, or hyphens.",
  invalid_display_name: "Display name must be between 1 and 64 bytes.",
  owner_mismatch: "Registration must use this device wallet.",
  name_taken: "That merchant name has already been registered.",
  registration_reverted: "Registration was rejected onchain. No name was registered.",
  registration_insufficient_gas: "Add Sepolia ETH to this wallet before registering.",
  registration_network: "Couldn't reach Sepolia. Check your connection and try again.",
  registration_failed: "Couldn't register this merchant name. Try again.",
  fallback: "Something went wrong. Try again.",
};

function getErrorMessage(code?: string | null): string {
  return code && Object.hasOwn(errorMessages, code)
    ? errorMessages[code as CopyErrorCode]
    : errorMessages.fallback;
}

function ensVerifiedLabel(ensName: string): string {
  return `${ensName} ✓`;
}

const labels = {
  amountDue: "Amount due",
  charge: "Charge",
  customerRole: "I'm paying",
  identityCheck: "Identity check",
  live: "Live",
  merchantRole: "I'm selling",
  nfcSignal: "NFC ))",
  noEmulation: "This phone can't serve taps. QR only.",
  payWith: "Pay with",
  readyToTap: "Ready to tap",
  tagline: "Pay and get paid with a tap",
  tamperDemo: "Demo: tampered tag",
  verifiedToPay: "Verified to pay",
  yourWallet: "Your wallet",
} as const;

const entry = {
  loading: "Opening your wallet…",
  walletError: "Couldn't open your wallet",
  walletRecovery: "Unlock your device and try again. Your stored wallet has not been replaced.",
  preferencesError: "Couldn't load your preferences",
  preferencesRecovery:
    "Try again, or reset only preferences to repeat setup. Your wallet stays on this device.",
  resetPreferences: "Reset preferences only",
  saveError: "Couldn't save your preferences. Try again before leaving the app.",
  retry: "Try again",
  welcome: "Welcome to Tap",
  introduction: "Review who you're paying before you confirm.",
  testnet: "Testnet only · Base Sepolia",
  deviceWallet:
    "Tap creates a wallet on this device, stored in secure storage. There is no sign-in or cloud recovery. Losing the app's stored key loses access to its funds and names.",
  verification:
    "Payment requests are checked against the merchant's signature and ENS name. Opening Tap never starts a scan or sends a payment.",
  preference: "Preferred payment method",
  nfc: "NFC tap",
  qr: "QR code",
  continue: "Open my wallet",
  saving: "Saving…",
  home: "Tap",
  ready: "Pay with confidence",
  homeDetail:
    "Start a scan when you're ready. You'll review the verified merchant and amount before paying.",
  scan: "Start a payment",
  merchant: "Merchant tools",
  merchantDetail:
    "Create payment requests or register a merchant name with this device wallet. A saved name alone does not verify a merchant.",
  settings: "Settings",
  back: "Back",
  done: "Back to home",
  fakeChain: "DEVELOPMENT ONLY · FAKE CHAIN",
  developmentTools: "Development only",
  developmentWarning:
    "Test helpers can simulate balances, verification and payment results. They do not prove a real payment or merchant identity.",
  resetWallet: "Replace development wallet",
  resetWalletWarning:
    "This replaces this device's stored key. Registered merchant names and funds stay linked to the old wallet and cannot be recovered here. There is no cloud backup.",
  resetWalletFailed: "Couldn't replace the wallet. The previous wallet is still available.",
  balanceRetry: "Refresh balances",
} as const;

const scan = { start: "Read NFC request", cancel: "Cancel NFC scan", qr: "Scan QR code" } as const;

const pilot = {
  title: "Gas sponsorship pilot",
  inactive: "Not enabled · Base Sepolia USDC only",
  explanation:
    "Tap-funded fees are being tested. You can preview a separate customer account; your existing wallet and merchant identity stay in place. Each future payment still needs your confirmation.",
  preview: "Preview separate customer account",
  previewFailed: "Couldn't read the pilot account address. Check your connection and try again.",
  owner: "Existing wallet / merchant signer",
  payer: "Separate pilot payer · independent balance",
  noMigration:
    "Preview does not deploy an account or move funds. Pilot recovery and provider checks are still pending; don't fund this preview account yet.",
  optIn: "Remember this pilot account (inactive)",
  selected: "Pilot account remembered · payments still disabled",
  optOut: "Forget pilot selection",
  pending: "Payment status needs checking",
  pendingDetail:
    "A pending pilot record or unavailable secure storage is blocking new and fallback payments. Restore storage access or reconcile the pending operation before continuing. No payment starts on this screen.",
  resetBlocked: "Resolve the pending pilot payment before replacing this wallet.",
} as const;

export const copy = {
  errorMessages,
  getErrorMessage,
  ensVerifiedLabel,
  labels,
  entry,
  scan,
  pilot,
} as const;
