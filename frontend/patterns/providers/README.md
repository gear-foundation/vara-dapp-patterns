# Provider Patterns

This directory contains reusable React provider patterns commonly used in Vara frontend applications.

Each pattern encapsulates a specific concern (API access, state management, data fetching, composition) and is designed to be:
- explicit
- configurable
- easy to reuse across projects

---

## Available patterns

### `with-providers`
A composition pattern that centralizes all application-wide providers into a single wrapper.

Use this pattern to:
- keep `App.tsx` / `main.tsx` clean
- enforce a consistent provider order
- configure core Vara providers in one place

---

### `query-provider`
A shared React Query provider with a configuration optimized for blockchain-based data.

Use this pattern to:
- avoid implicit background refetches
- control cache invalidation explicitly
- keep data fetching predictable

---

## Recommended provider order

1. API provider
2. Account provider
3. Alert provider
4. Query provider
5. Router / Theme / other app-level providers

---

## Design principles

- One responsibility per provider
- No hardcoded app-specific values
- Explicit configuration over implicit behavior

These patterns are meant to be composed together, not used in isolation.
