# 03 · Contracts

Three contracts, two chains. `TapSwapPay` is the additive Base Sepolia adapter: it swaps bounded
native ETH or Permit2 ERC-20 input for the request's exact USDC amount, then calls `TapPay`
atomically. It validates exact-output path boundaries, refunds unused input, and reverts the swap
if settlement fails. Fee-on-transfer and rebasing input tokens are intentionally unsupported.

| Contract | Chain | Job |
|---|---|---|
| `TapPay` | Base Sepolia (84532) | Settles a merchant-signed payment request. Links payment ↔ request, blocks replay/expiry, emits one clean `Paid` event |
| `TapSwapPay` | Base Sepolia (84532) | Converts bounded ETH or standard ERC-20 input into exact USDC, then settles through `TapPay` |
| `TapMerchantRegistrar` | Sepolia (11155111) | Issues merchant subnames under `tap.eth` on our ENSv2 UserRegistry and writes their address + display-name records |

**Why a contract at all for payments:** a plain ERC-20 transfer can't tell the merchant *which* request was paid; two $5 payments look identical. TapPay ties each payment to a signed request, rejects expired or replayed requests, and emits one event the merchant can watch.

---

## Foundry setup

```
contracts/
├─ foundry.toml
├─ src/
│  ├─ TapPay.sol
│  ├─ TapMerchantRegistrar.sol
│  └─ interfaces/ITapResolver.sol     # minimal PermissionedResolver setters we call
├─ test/
│  ├─ TapPay.t.sol
│  ├─ TapMerchantRegistrar.t.sol
│  ├─ mocks/MockERC20Permit.sol        # OZ ERC20Permit, 6 decimals, open mint
│  ├─ mocks/MockERC1271Wallet.sol      # smart-wallet merchant
│  ├─ mocks/MockPermissionedRegistry.sol
│  ├─ mocks/MockTapResolver.sol
│  └─ fixtures/hash-vector.json        # shared with packages/core tests (INV-09)
└─ script/
   └─ DeployTapPay.s.sol
```

Dependencies:
```bash
cd contracts
forge install ensdomains/contracts-v2    # brings its own OpenZeppelin checkout
forge install foundry-rs/forge-std
```

`foundry.toml`:
```toml
[profile.default]
src = "src"
test = "test"
script = "script"
out = "out"
libs = ["lib"]
solc_version = "0.8.26"
optimizer = true
optimizer_runs = 200
fs_permissions = [{ access = "read", path = "./test/fixtures" }]
remappings = [
  "@ensdomains/contracts-v2/=lib/contracts-v2/contracts/src/",
  "@openzeppelin/contracts/=lib/contracts-v2/contracts/lib/openzeppelin-contracts/contracts/",
  "forge-std/=lib/forge-std/src/",
]

[rpc_endpoints]
base_sepolia = "${BASE_SEPOLIA_RPC}"
sepolia = "${SEPOLIA_RPC}"
```
One OpenZeppelin copy only (the one inside `contracts-v2`), so there are no version clashes. If `contracts-v2` pins an OZ version lacking something we need, stop and raise it. Don't add a second OZ.

---

## `TapPay.sol` 🔒

### Interface
```solidity
struct PaymentRequest {
    address merchant;      // payout address AND signer
    address token;
    uint256 amount;        // token base units
    bytes32 nonce;         // random per charge
    uint64  expiry;        // unix seconds
    string  merchantName;  // "yoyogi-market.tap.eth"
}

event Paid(address indexed merchant, bytes32 indexed nonce,
           address indexed payer, address token, uint256 amount);

error Expired();
error ZeroAmount();
error NonceUsed();
error BadSignature();

bytes32 public constant PAYMENT_REQUEST_TYPEHASH = keccak256(
    "PaymentRequest(address merchant,address token,uint256 amount,bytes32 nonce,uint64 expiry,string merchantName)");

function payWithPermit(PaymentRequest calldata req, bytes calldata sig,
                       uint256 deadline, uint8 v, bytes32 r, bytes32 s) external;
function pay(PaymentRequest calldata req, bytes calldata sig) external;
function isPaid(address merchant, bytes32 nonce) external view returns (bool);
function hashRequest(PaymentRequest calldata req) external view returns (bytes32);
```

### Reference implementation
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract TapPay is EIP712 {
    using SafeERC20 for IERC20;

    // struct, event, errors, typehash as above

    mapping(address merchant => mapping(bytes32 nonce => bool)) private _used;

    constructor() EIP712("TapPay", "1") {}

    function hashRequest(PaymentRequest calldata req) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            PAYMENT_REQUEST_TYPEHASH,
            req.merchant, req.token, req.amount, req.nonce, req.expiry,
            keccak256(bytes(req.merchantName))
        )));
    }

    function isPaid(address merchant, bytes32 nonce) external view returns (bool) {
        return _used[merchant][nonce];
    }

    function payWithPermit(PaymentRequest calldata req, bytes calldata sig,
                           uint256 deadline, uint8 v, bytes32 r, bytes32 s) external {
        // permit can be front-run; if it fails, fall through and rely on the existing allowance
        try IERC20Permit(req.token).permit(msg.sender, address(this), req.amount, deadline, v, r, s) {} catch {}
        _settle(req, sig);
    }

    function pay(PaymentRequest calldata req, bytes calldata sig) external {
        _settle(req, sig);
    }

    function _settle(PaymentRequest calldata req, bytes calldata sig) internal {
        if (block.timestamp >= req.expiry) revert Expired();                               // 1
        if (req.amount == 0) revert ZeroAmount();                                          // 2
        if (_used[req.merchant][req.nonce]) revert NonceUsed();                            // 3
        if (!SignatureChecker.isValidSignatureNow(req.merchant, hashRequest(req), sig))    // 4
            revert BadSignature();
        _used[req.merchant][req.nonce] = true;                                             // 5
        IERC20(req.token).safeTransferFrom(msg.sender, req.merchant, req.amount);          // 6
        emit Paid(req.merchant, req.nonce, msg.sender, req.token, req.amount);             // 7
    }
}
```

### Rules
- The order of checks in `_settle` is fixed (effects before interaction).
- No owner, admin, pause, fee, upgradeability or token custody. The contract never holds funds.
- `eip712Domain()` (EIP-5267) is inherited. `@tap/core` may use it to confirm the domain at startup.
- Any change to the struct, typehash or domain is a 🔒 decision: update `hash-vector.json`, `packages/core/src/request/sign.ts`, and this doc in the same commit.

### Tests (`test/TapPay.t.sol`)
`test/PilotBatch.t.sol` additionally checks caller-as-payer, consumed exact approval,
and rollback of approval when settlement fails through an ABI-compatible revert-all
batch fixture. It is not Coinbase Smart Wallet or EntryPoint deployment evidence and
does not establish provider compatibility. D36 integration remains disabled.

All signatures come from `vm.sign` (merchant request signature and customer permit signature). Token is `MockERC20Permit` (6 decimals).

| Test | Asserts |
|---|---|
| `test_PayWithPermit_HappyPath` | balances move by `amount`, `Paid` emitted with exact args, `isPaid` true, allowance back to 0 |
| `test_Pay_HappyPath` | approve flow works identically |
| `test_RevertWhen_Replay` | second settle → `NonceUsed` |
| `test_RevertWhen_Expired` | `vm.warp(expiry)` → `Expired` (boundary: `==` expiry reverts) |
| `test_RevertWhen_ZeroAmount` | `ZeroAmount` |
| `test_RevertWhen_WrongSigner` | request signed by another key → `BadSignature` |
| `test_RevertWhen_TamperedAmount` / `_TamperedToken` / `_TamperedName` / `_TamperedNonce` / `_TamperedExpiry` / `_TamperedMerchant` | each → `BadSignature` |
| `test_RevertWhen_WrongChain` | sign with a domain for another chainId → `BadSignature` |
| `test_PermitFrontRun_StillSettles` | submit the permit directly first, then `payWithPermit` still settles |
| `test_RevertWhen_NoAllowance` | bad permit + no allowance → reverts (SafeERC20) |
| `test_SmartWalletMerchant_ERC1271` | `MockERC1271Wallet` merchant accepted |
| `test_HashParity_FixedVector` | with `vm.chainId(84532)` and `deployCodeTo("TapPay.sol", vector.verifyingContract)`, `hashRequest(vector.request) == vector.digest` |
| `testFuzz_TamperAnyField` | fuzz one field change → `BadSignature` |

### Shared hash vector (INV-09)
`contracts/test/fixtures/hash-vector.json`:
```json
{
  "chainId": 84532,
  "verifyingContract": "0x00000000000000000000000000000000000Ca5E1",
  "request": {
    "merchant": "0x…", "token": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    "amount": "5000000", "nonce": "0x…32 bytes…", "expiry": "1790000000",
    "merchantName": "yoyogi-market.tap.eth"
  },
  "digest": "0x…"
}
```
Generate `digest` once with `bun run scripts/print-hash-vector.ts` (viem's `hashTypedData`), commit it, and never regenerate it to make a failing test pass. Both `forge test` and `bun test` read this same file.

### Deploy
```bash
cd contracts
forge script script/DeployTapPay.s.sol --rpc-url base_sepolia --broadcast --private-key $DEPLOYER_PK
```
Then, **in one commit**: paste the address into `packages/core/src/config/chains.ts` → `chains[84532].tapPay`, run `bun run abi`, and tell your teammate. Record the deploy tx in the README.

---

## `TapMerchantRegistrar.sol`

Our own subname registrar for `tap.eth`, modelled on the ENSv2 `SimpleSubnameRegistrar` tutorial. This is where ENSv2 is central: our own **UserRegistry** (hierarchical registry), a registrar authorised through **Enhanced Access Control** roles, and records written to our **PermissionedResolver**.

### Behaviour
- `register(label, owner, displayName)`:
  1. `label` is 3–32 chars of `[a-z0-9-]`, not starting or ending with `-` (ASCII only, so it's already ENS-normalized), else `InvalidLabel`.
  2. `owner != address(0)`, else `InvalidOwner`.
  3. `displayName` is 1–64 bytes, else `InvalidDisplayName`.
  4. Label available in our UserRegistry, else `NameNotAvailable`.
  5. `REGISTRY.register(label, owner, IRegistry(address(0)), address(RESOLVER), MERCHANT_ROLES, type(uint64).max)`, which never expires.
  6. On our resolver: `setAddress(dns(label.tap.eth), 60, abi.encodePacked(owner))` and `setText(dns(label.tap.eth), "name", displayName)`.
  7. Emit `MerchantRegistered(tokenId, label, owner, displayName)`.
- Registration is **free and permissionless** for the hackathon (first come, first served). Anti-squatting is a "What's next" item.
- The merchant receives `ROLE_SET_RESOLVER` on their subname (`MERCHANT_ROLES`), so they can later graduate to their own resolver. We (the `tap.eth` owner) keep root roles on the UserRegistry. This is a **managed** namespace, and the README says so.

### Reference implementation
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPermissionedRegistry} from "@ensdomains/contracts-v2/registry/interfaces/IPermissionedRegistry.sol";
import {IRegistry} from "@ensdomains/contracts-v2/registry/interfaces/IRegistry.sol";
import {RegistryRolesLib} from "@ensdomains/contracts-v2/registry/libraries/RegistryRolesLib.sol";
import {ITapResolver} from "./interfaces/ITapResolver.sol";

contract TapMerchantRegistrar {
    error InvalidLabel(string label);
    error InvalidOwner();
    error InvalidDisplayName();
    error NameNotAvailable(string label);

    event MerchantRegistered(uint256 indexed tokenId, string label, address indexed owner, string displayName);

    uint256 public constant COIN_TYPE_ETH = 60;
    string  public constant DISPLAY_NAME_KEY = "name";
    uint256 public constant MERCHANT_ROLES = RegistryRolesLib.ROLE_SET_RESOLVER;

    IPermissionedRegistry public immutable REGISTRY;   // our UserRegistry for tap.eth
    ITapResolver public immutable RESOLVER;            // our PermissionedResolver
    bytes public parentDns;                            // DNS-encoded "tap.eth" = 0x037461700365746800

    constructor(IPermissionedRegistry registry, ITapResolver resolver, bytes memory parentDns_) {
        REGISTRY = registry;
        RESOLVER = resolver;
        parentDns = parentDns_;
    }

    function isAvailable(string calldata label) public view returns (bool) {
        IPermissionedRegistry.State memory st = REGISTRY.getState(uint256(keccak256(bytes(label))));
        return st.status == IPermissionedRegistry.Status.AVAILABLE;
    }

    function register(string calldata label, address owner, string calldata displayName)
        external returns (uint256 tokenId)
    {
        if (!isValidLabel(label)) revert InvalidLabel(label);
        if (owner == address(0)) revert InvalidOwner();
        uint256 dl = bytes(displayName).length;
        if (dl == 0 || dl > 64) revert InvalidDisplayName();
        if (!isAvailable(label)) revert NameNotAvailable(label);

        tokenId = REGISTRY.register(label, owner, IRegistry(address(0)), address(RESOLVER),
                                    MERCHANT_ROLES, type(uint64).max);

        bytes memory dns = abi.encodePacked(uint8(bytes(label).length), label, parentDns);
        RESOLVER.setAddress(dns, COIN_TYPE_ETH, abi.encodePacked(owner));
        RESOLVER.setText(dns, DISPLAY_NAME_KEY, displayName);

        emit MerchantRegistered(tokenId, label, owner, displayName);
    }

    function isValidLabel(string calldata label) public pure returns (bool) {
        bytes calldata b = bytes(label);
        if (b.length < 3 || b.length > 32) return false;
        if (b[0] == "-" || b[b.length - 1] == "-") return false;
        for (uint256 i; i < b.length; ++i) {
            bytes1 c = b[i];
            if (!((c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c == "-")) return false;
        }
        return true;
    }
}
```

`src/interfaces/ITapResolver.sol`:
```solidity
interface ITapResolver {
    function setAddress(bytes calldata name, uint256 coinType, bytes calldata addressBytes) external;
    function setText(bytes calldata name, string calldata key, string calldata value) external;
}
```

> ⚠️ ENSv2 contracts are **not final**. Before writing this, run `forge build` against the installed `contracts-v2` and confirm `IPermissionedRegistry.register(...)`, `getState(...)`, `State`, `Status.AVAILABLE` and `RegistryRolesLib.ROLE_SET_RESOLVER` match. If they differ, adapt the registrar to the installed interface and note it in `decisions.md`.

### Roles the registrar needs (granted by `scripts/setup-ens.ts`)
| On | Role | Why |
|---|---|---|
| Our UserRegistry (`ROOT_RESOURCE`) | `ROLE_REGISTRAR` (`1 << 0`) | call `register()` |
| Our PermissionedResolver (root) | `ROLE_SET_ADDRESS` (`1 << 0`) | write the merchant's address |
| Our PermissionedResolver (root) | `ROLE_SET_TEXT` (`1 << 4`) | write the display name |

Resolver roles have no per-name scoping: a holder can write those record types for any name served by the resolver. The registrar's code only writes to the name it just registered, and it has no other write paths. This is the documented trade-off and goes in the README.

### Tests (`test/TapMerchantRegistrar.t.sol`, with mocks)
| Test | Asserts |
|---|---|
| `test_Register_HappyPath` | registry called with `(label, owner, 0, resolver, MERCHANT_ROLES, max)`; resolver got `setAddress(dns, 60, owner)` and `setText(dns, "name", displayName)`; event emitted |
| `test_DnsEncoding` | `dns("yoyogi-market")` == `0x0d796f796f67692d6d61726b6574037461700365746800` |
| `test_RevertWhen_Taken` | second register of the same label → `NameNotAvailable` |
| `test_RevertWhen_InvalidLabel` | `""`, `"ab"`, 33 chars, `"Yoyogi"`, `"a.b"`, `"-abc"`, `"abc-"`, `"ábc"` → `InvalidLabel` |
| `test_RevertWhen_ZeroOwner` | `InvalidOwner` |
| `test_RevertWhen_BadDisplayName` | empty, 65 bytes → `InvalidDisplayName` |

An optional fork test (`test/fork/`, not in `bun run check`) can run against live Sepolia after setup: `forge test --match-path test/fork/* --fork-url $SEPOLIA_RPC`.

### Deploy
Deployed by `scripts/setup-ens.ts` (see `04-ens.md`), because it needs the UserRegistry and resolver addresses produced in earlier setup steps. The address then goes into `packages/core/src/config/chains.ts` → `ens.merchantRegistrar`.
