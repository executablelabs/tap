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

const scan = { start: "Read NFC request", cancel: "Cancel NFC scan", qr: "Scan QR code" } as const;

export const copy = { errorMessages, getErrorMessage, ensVerifiedLabel, labels, scan } as const;
