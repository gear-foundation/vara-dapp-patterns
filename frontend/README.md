# Frontend Patterns

This directory contains reusable frontend patterns for building React applications on the Vara network.

The goal of these patterns is to provide standardized, battle-tested solutions for common dApp frontend concerns such as:

- interacting with Vara programs from the UI  
- preparing transactions from domain parameters  
- executing signed transactions  
- verifying real on-chain success  
- managing application-wide providers  
- handling asynchronous blockchain state  
- composing predictable and reliable data flows  

All patterns are designed to be:

- **explicit** : behavior is transparent and easy to reason about  
- **composable** : patterns can be combined to build more complex flows  
- **framework-friendly** : built on top of widely adopted tools (React, React Query, Gear JS)

---

## Directory structure

### `hooks/`

Reusable React hooks that encapsulate common interaction patterns with Vara programs.

Available patterns:

- **`prepare-program-tx`**  
  A builder pattern responsible exclusively for **transaction preparation**.  
  It transforms UI/domain parameters into a ready-to-execute transaction using Gear JS hooks.

  This pattern:
  - validates prerequisites (program + account)
  - maps parameters to program arguments
  - prepares a transaction
  - does **not** sign, send, or verify anything

- **`program-tx-mutation`**  
  An execution pattern that wraps `signAndSend()` into a React Query mutation.

  It provides:
  - standardized execution state (pending/success/error)
  - retries and callbacks through React Query
  - a predictable API for running prepared transactions

  This pattern handles **execution only** and does not prepare or verify transactions.

- **`verified-sign-and-send`**  
  A stronger execution pattern focused on **real success verification**.

  It goes beyond simple submission by verifying:

  - runtime events  
  - absence of `ExtrinsicFailed`  
  - Gear `MessageQueued` events  
  - program reply events  
  - finalized blocks (optional)

  This pattern ensures that a transaction is not only submitted, but actually executed successfully at the program level.

---

## Providers

### `providers/`

Reusable provider composition patterns for application infrastructure.

- **`with-providers`**  
  A composition utility that centralizes all global providers used in a typical Vara dApp, such as:
  - API connection  
  - account management  
  - notifications  
  - query caching  
  - routing  
  - theming  

- **`query-provider`**  
  A React Query provider preconfigured for blockchain use cases, including sensible defaults for:
  - caching  
  - refetching  
  - error handling  

---

### `shared/`

Common utilities used across multiple patterns.

Includes:

- constants  
- error helpers  
- small reusable functions  

These are intentionally kept minimal and generic.

---

## Design principles

These patterns follow a few core principles:

### Clear separation of responsibilities

Transactions in Vara dApps are modeled as distinct phases:

1. **Preparation** – building a valid transaction from UI parameters  
2. **Execution** – signing and sending to the network  
3. **Verification** – confirming real program-level success  

Each phase has its own dedicated pattern and API.

### Explicit control over effects

- Side effects are isolated  
- Network interactions are predictable  
- State management is delegated to React Query  
- No hidden behavior inside abstractions  

### Minimal assumptions

Patterns make as few assumptions as possible about:

- application architecture  
- UI frameworks  
- styling  
- domain logic  

## Recommended flows

### Basic execution
prepare-program-tx → program-tx-mutation

### Verified execution (strong guarantees)
prepare extrinsic → verified-sign-and-send

### Conceptual lifecycle
prepare → sign → send → verify

---

## Contributing

New patterns are welcome as long as they:

- solve a clearly defined problem  
- are reusable across applications  
- include minimal but complete examples  
- follow the existing structure and principles

## License

MIT

