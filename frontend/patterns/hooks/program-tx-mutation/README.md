# Program Tx Mutation (Prepare + Execute)

This pattern standardizes how frontend applications interact with Vara programs from React by combining:

- `usePrepareProgramTransaction` from **Gear JS React Hooks**
- `useMutation` from **React Query**

It provides a consistent, reusable abstraction for preparing and executing program transactions while keeping UI logic clean and predictable.

---

## Why this pattern exists

Most Vara dApps repeat the same workflow for every program interaction:

- Resolve the program instance
- Ensure a wallet account is available
- Map UI parameters to program arguments
- Prepare the transaction
- Manage loading and error states
- Optionally sign and send the transaction

Without a shared abstraction, this logic is duplicated across hooks and components, leading to:
- Boilerplate repetition
- Inconsistent error handling
- Diverging UX patterns
- Harder maintenance as the dApp grows

This pattern consolidates that logic into a single, composable hook.

---

## Core idea

The pattern separates **transaction preparation** from **transaction execution**, and allows the application to decide **where that responsibility lives**.

It supports **two integration strategies**, both valid and complementary.

---

## Integration modes

### 1. `prepare` mode (default)

**What it does**
- Prepares the transaction using `usePrepareProgramTransaction`
- Returns the prepared `transaction`
- Does **not** sign or send it

**Responsibility split**
- The hook is responsible for validating prerequisites and preparing a correct transaction
- The UI or calling layer is responsible for deciding *when* and *how* to sign and send

**Typical use cases**
- Flows that require user confirmation before execution
- DeFi interactions (swap, add liquidity, staking)
- Multi-step or batch transactions
- Custom UX around gas fees or transaction review

**Mental model**
> “Prepare first, execute later — the UI owns the execution.”

---

### 2. `signAndSend` mode

**What it does**
- Prepares the transaction
- Immediately signs and sends it using the connected wallet
- Returns the execution result

**Responsibility split**
- The hook fully owns the transaction lifecycle
- The UI simply triggers the action and reacts to loading/success/error

**Typical use cases**
- Simple, one-click actions
- Token transfers
- Standard contract calls without intermediate confirmation

**Mental model**
> “Click once, execute immediately.”

---

## API

```ts
useProgramTxMutation({
  program,
  serviceName,
  functionName,
  mapArgs,
  gasLimit?,        // optional
  mode?,            // 'prepare' | 'signAndSend'
  mutationOptions?, // react-query callbacks
})
```

## Key parameters

- **`program`**  
  Instance of the Vara program client (e.g. a Sails-generated program).

- **`serviceName` / `functionName`**  
  Identify the exact program method being called.

- **`mapArgs(params)`**  
  Maps domain-specific parameters to the argument list expected by the program.

- **`gasLimit` *(optional)***  
  Explicit gas limit for calls that require it.

- **`mode` *(optional)***  
  Controls whether the hook only prepares the transaction or also executes it.  
  Defaults to `prepare`.

- **`mutationOptions` *(optional)***  
  Standard React Query options (`onError`, `onSuccess`, retries, etc.).

---

## Error handling

Errors are intentionally surfaced through React Query:

- Missing `program` or `account` results in a thrown error
- Execution failures trigger `onError` handlers if provided
- UI components can rely on `error` and `isPending` states for feedback

This ensures consistent and predictable error flows across the application.

---

## Examples

This pattern is meant to be used through thin, domain-specific wrappers.

See `../examples/*` for concrete implementations.
