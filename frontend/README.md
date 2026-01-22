# Frontend Patterns

This directory contains reusable frontend patterns for building Vara-based React applications.

The goal of these patterns is to standardize how dApps:
- interact with Vara programs
- execute and verify transactions
- manage global providers
- share common frontend infrastructure

All patterns are designed to be **explicit**, **composable**, and **framework-friendly**.

---

## Structure overview

### `hooks/`
Reusable React hooks that encapsulate common interaction patterns with Vara programs.

- **`program-tx-mutation`**  
  A builder pattern for preparing and optionally executing program transactions using Gear JS hooks and React Query.

- **`verified-sign-and-send`**  
  An execution and verification pattern that guarantees real transaction success by inspecting runtime events and program replies.

---

### `providers/`
Reusable provider patterns for composing application-wide context.

- **`with-providers`**  
  A composition pattern that centralizes all global providers (API, accounts, alerts, query, routing, theme).

- **`query-provider`**  
  A shared React Query provider configured for predictable, blockchain-friendly data fetching.

---

### `shared/`
Shared frontend utilities used across patterns.

Includes:
- constants
- error helpers
- small reusable utilities

---

## Design principles

- Clear separation between **building**, **executing**, and **verifying** transactions
- Explicit control over side effects and data fetching
- Minimal assumptions about application structure
- Patterns are composable and independent

---

## Intended usage

These patterns are meant to be:
- used as building blocks for dApps
- adapted to different UX requirements
- combined to form more complex flows (e.g. prepare → verify & execute)

They are not tied to a specific application and can be reused across Vara projects.
