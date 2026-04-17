# gear-ez-transactions Pattern (React / Vara)

A complete reference implementation of the **signless + gasless transaction pattern** for Vara dApps using the `gear-ez-transactions` library.

This pattern eliminates the two largest UX friction points in blockchain applications:
- **Gasless**: users interact with contracts without holding any VARA tokens.
- **Signless**: users submit multiple transactions without wallet pop-ups on each one.

## Full code reference

- Balance guard hook: [`hooks/use-check-balance.ts`](./hooks/use-check-balance.ts)
- Sign-and-send orchestrator: [`hooks/use-sign-and-send.ts`](./hooks/use-sign-and-send.ts)
- Full component example: [`examples/SwitchSignless.tsx`](./examples/SwitchSignless.tsx)
- Provider composition: [`examples/withProviders.tsx`](./examples/withProviders.tsx)

---

## Core concepts

### Signless sessions

A signless session creates an **ephemeral key pair** in the browser. The session registers this ephemeral key on-chain as a delegate for a specific set of allowed actions. Once active:

- Transactions are signed with the ephemeral key (no wallet pop-up).
- The session validates on the contract side via `get_original_address()`.
- The session has an expiry (timestamp + block-based).

### Gasless vouchers

A gasless voucher is an on-chain escrow funded by a backend (the gasless server). When attached to a transaction:

- The Gear runtime pays the gas from the voucher balance instead of the user's account.
- The user's VARA balance is never touched.
- The voucher is scoped to a specific program.

### gear-ez-transactions

The `gear-ez-transactions` library unifies signless and gasless into a single cohesive API, abstracting:

- Ephemeral key generation and storage
- Session creation and deletion on-chain
- Voucher requesting from a backend
- Preparing transaction params that wire up the session + voucher automatically

---

## What gear-ez-transactions provides

| Export | Type | Description |
|--------|------|-------------|
| `useEzTransactions()` | Hook | Combined state: `{ signless, gasless }` |
| `useSignlessTransactions()` | Hook | Signless session state: `{ isActive, voucher, ... }` |
| `useGaslessTransactions()` | Hook | Gasless voucher state: `{ isEnabled, voucherId, voucherStatus, requestVoucher }` |
| `usePrepareEzTransactionParams()` | Hook | Returns `prepareEzTransactionParams(useSignless)` |
| `EzTransactionsProvider` | Component | Top-level context provider |
| `EnableSignlessSession` | Component | UI switcher for signless activation/deactivation |

---

## High-level architecture

```
User connects wallet
         │
         ▼
EzTransactionsProvider initializes
         │
         ├── gasless.requestVoucher(address) ─────────────────► Gasless Backend
         │                                                            │
         │                                                   api.voucher.issue()
         │                                                            │
         │◄── gasless.voucherStatus.enabled === true ────────────────┘
         │
         ├── EnableSignlessSession (user toggles switcher)
         │         │
         │         ├── generate ephemeral key pair (in-browser)
         │         ├── create_session(key, allowedActions) ──── Vara Network
         │         │   (gas paid by voucher)
         │         └── signless.isActive === true
         │
         ▼
handleSendHello()
         │
         ├── prepareEzTransactionParams(false)
         │         → { sessionForAccount, account, gasLimit, ... }
         │
         ├── prepareTransactionAsync({ args, value, ...params })
         │         → { transaction }
         │
         ├── checkBalance(calculatedGas)
         │         → verifies voucher has enough funds
         │
         └── transaction.signAndSend()
                   → signed with ephemeral key
                   → gas deducted from voucher
                   → program validates sessionForAccount
```

---

## Key fragment: `useSignAndSend`

```typescript
export const useSignAndSend = () => {
  const { signless, gasless } = useEzTransactions();

  // Resolve which balance to check: gasless voucher > signless voucher > user wallet
  const { checkBalance } = useCheckBalance({
    signlessPairVoucherId: signless.voucher?.id,
    gaslessVoucherId: gasless.voucherId,
  });

  const signAndSend = (transaction, options?) => {
    // Gas estimate is embedded in the prepared extrinsic as the 3rd argument
    const calculatedGas = Number(transaction.extrinsic.args[2].toString());

    checkBalance(
      calculatedGas,
      () => {
        // Only executed if balance check passes
        void transaction
          .signAndSend()
          .then(({ response }) => response().then(() => options?.onSuccess?.()))
          .catch((error) => { options?.onError?.(); alert.error("Transaction failed"); });
      },
      options?.onError
    );
  };

  return { signAndSend };
};
```

**Why is `calculatedGas` read from `transaction.extrinsic.args[2]`?**

The Gear extrinsic for `send_message` encodes arguments as:
```
[programId, payload, gasLimit, value]
          index 0    1        2      3
```
`calculateGas()` writes the estimated gas into index 2. Reading it here allows `checkBalance` to compare against the actual gas budget without re-estimating.

---

## Key fragment: `usePrepareEzTransactionParams`

```typescript
const { prepareEzTransactionParams } = usePrepareEzTransactionParams();

// Inside a handler:
const { sessionForAccount, ...params } = await prepareEzTransactionParams(false);
//                                                                           ^
//                                                          false = gasless only
//                                                          true  = signless only

const { transaction } = await prepareTransactionAsync({
  args: [...],
  value: 0n,
  ...params, // injects: account, gasLimit, voucherId, etc.
});
```

`prepareEzTransactionParams` is the bridge between ez-transactions state and the Gear JS hooks API. It reads the current session/voucher state and returns the parameters that `prepareTransactionAsync` needs to wire up the gasless voucher and signless session key automatically.

**`sessionForAccount`** is the original user's address. It must be passed as the first argument to session-aware contract methods so the contract can resolve `msg::source()` to the original account instead of the ephemeral key.

---

## Key fragment: `EnableSignlessSession` component

```tsx
<EnableSignlessSession
  type="switcher"       // render a toggle switch UI
  requiredBalance={0}   // minimum VARA required in the signless pair account
  allowedActions={["SayHello", "SayPersonalHello"]}
/>
```

This component handles the entire signless lifecycle:
1. **ON**: generates an ephemeral key pair, calls `create_session()` on-chain, stores key in browser.
2. **OFF**: calls `delete_session_from_account()` on-chain, removes key from browser.

The `allowedActions` array must match the `ActionsForSession` enum variants defined in the smart contract's signless configuration.

---

## Voucher request lifecycle

```typescript
// Triggered once per account, on mount
useEffect(() => {
  if (!account || !gasless.isEnabled || hasRequestedOnceRef.current) return;
  hasRequestedOnceRef.current = true;  // prevent double-request

  const requestVoucherSafely = async () => {
    // Skip if already active (avoids duplicate issuance)
    if (gasless.voucherStatus?.enabled) return;

    await gasless.requestVoucher(account.address);

    // Brief poll to confirm on-chain activation (max ~1.5 seconds)
    for (let i = 0; i < 5; i++) {
      await new Promise(r => setTimeout(r, 300));
      if (gasless.voucherStatus?.enabled) break;
    }
  };

  void requestVoucherSafely();
}, [account?.address, gasless.isEnabled]);
```

`gasless.requestVoucher(address)` calls the gasless server's `POST /gasless/voucher/request` endpoint. The server submits the `api.voucher.issue()` extrinsic and returns the voucher ID. The frontend polls briefly for the voucher to become active on-chain.

---

## Why `useRef` for `hasRequestedOnceRef`?

React 18 StrictMode mounts components twice in development. Using `useState` for a "requested once" flag would cause it to reset on the second mount. A `useRef` persists across remounts without triggering a re-render, ensuring exactly one voucher request per account per session.

---

## `checkBalance` formula explained

```
required = existentialDeposit + gasLimit * valuePerGas
```

| Term | Source | Description |
|------|--------|-------------|
| `existentialDeposit` | `api.existentialDeposit` | Minimum balance to keep an account alive |
| `gasLimit` | `transaction.extrinsic.args[2]` | Estimated gas for this transaction |
| `valuePerGas` | `api.valuePerGas` | VARA cost per gas unit |

The check ensures the balance source (voucher or user wallet) can cover both the gas cost and leave the account above the existential deposit threshold. Failing this check would result in an on-chain error; alerting the user beforehand prevents wasted UX.

---

## Why signless + gasless work together

Signless session creation itself costs gas. Without a gasless voucher, enabling signless would require the user to have VARA to pay for the session setup — defeating the purpose. The correct flow is:

1. **Gasless first**: request a voucher for the user.
2. **Signless second**: use the voucher to pay for creating the signless session on-chain.
3. **All subsequent transactions**: signed with the ephemeral key, gas paid by the voucher.

This is why `EzTransactionsProvider` must be initialized before the signless session is activated.

---

## Provider composition (`withProviders`)

```tsx
<QueryClientProvider client={queryClient}>
  <ApiProvider initialArgs={{ endpoint: NODE_ADDRESS }}>
    <AccountProvider>
      <AlertProvider>
        <EzTransactionsProvider backendAddress={GASLESS_BACKEND} allowedActions={[]}>
          <App />
        </EzTransactionsProvider>
      </AlertProvider>
    </AccountProvider>
  </ApiProvider>
</QueryClientProvider>
```

`EzTransactionsProvider` depends on `ApiProvider` (for the Gear API) and `AccountProvider` (for the wallet account). It must be nested inside both. The `backendAddress` is the URL of the gasless server that handles voucher issuance.

---

## Environment variables

| Variable | Description |
|----------|-------------|
| `VITE_PROGRAMID` | HexString of the target Vara program |
| `VITE_NODE_ADDRESS` | WebSocket URL of the Vara network |
| `VITE_GASLESS_BACKEND_URL` | URL of the gasless server (`/gasless/voucher/request`) |

---

## Installation

```bash
yarn add gear-ez-transactions @gear-js/react-hooks @gear-js/api
yarn add @polkadot/util @polkadot/util-crypto
yarn add @tanstack/react-query
```

---

## Troubleshooting

### Voucher not activating

- Verify `VITE_GASLESS_BACKEND_URL` points to a running gasless server.
- Check the gasless server logs for `ExtrinsicFailed` events — the issuer account may be underfunded.
- The polling loop (5 × 300ms) may be too short for a slow network. Increase retries or the delay.

### Signless session not appearing

- The `allowedActions` in `EnableSignlessSession` must exactly match the `ActionsForSession` enum variants in your smart contract.
- Verify the contract was deployed with the signless session macro (`generate_session_system!`).

### "Low balance" alert fires unexpectedly

- The gasless voucher may have been depleted. Use `GET /gasless/voucher/:id/status` to check the voucher balance.
- Call `POST /prolong` to top up the voucher from the gasless server.

### `sessionForAccount` is undefined

- This happens if `prepareEzTransactionParams` is called before a signless session is active.
- Guard with `if (!signless.isActive) return` before calling the prepare function.

---

## Summary

The `gear-ez-transactions` pattern encapsulates three layers:

1. **Voucher layer** (`gasless`): backend-funded escrow that covers gas costs.
2. **Session layer** (`signless`): ephemeral key pair that eliminates wallet pop-ups.
3. **Transaction layer** (`useSignAndSend` + `usePrepareEzTransactionParams`): wires both layers into the standard Gear JS hooks API.

Together they provide a Web2-grade user experience on a Web3 blockchain, where users interact with smart contracts as effortlessly as using any web application.
