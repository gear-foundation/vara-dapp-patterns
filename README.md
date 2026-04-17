# vara-dapp-patterns

A curated collection of **production-oriented patterns** for building on **Gear / Vara** with **Sails**, **Gear JS**, and **Sails JS**.

The repository is organized as a set of **small, isolated, well-documented** examples that you can:
- read in one sitting,
- adapt for real projects,
- combine into larger architectures,
- validate locally with `gtest` or frontend/infrastructure examples.

> This repo focuses on reusable engineering patterns: contract design, delegation flows, client interaction, backend gateways, and frontend transaction orchestration.

---

## What this repo is for

This repo is useful if you are building on Gear/Vara and want ready-to-use references for:

- **Contract patterns**: factories, delayed self-messages, service composition, policy wrappers
- **Delegation flows**: signless / gasless sessions and voucher-backed UX
- **Frontend patterns**: transaction preparation, execution, verification, provider composition
- **Backend patterns**: REST gateways, token-gated auth, voucher management
- Clean `no_std` storage wiring with `RefCell`
- Minimal integration testing with `sails-rs` + `gtest`

Each pattern aims to be:
- minimal but realistic,
- easy to audit,
- supported by tests and/or a guide.

---

## Repository structure

The repository is split into three areas:

```text
contracts/       # Sails / Gear contract patterns
frontend/        # React, Gear JS, Sails JS integration patterns
infrastructure/  # Express / Node backend patterns around Vara programs
```

Contract examples are self-contained Cargo workspaces and typically look like:

```text
<pattern>/
  app/        # Program + services
  client/     # Generated Rust client from IDL
  src/        # WASM export helpers for tests
  tests/      # gtest integration tests
  Cargo.toml
  README.md
```

---

## Included patterns

### Contract patterns

**`contracts/factory`**
- A factory program that instantiates another program from a pre-uploaded `CodeId`.
- Shows async creation via `create_program_bytes_with_gas_for_reply(...).await` and separate error handling for submission vs reply.

**`contracts/factory-child`**
- The minimal child program used by the factory example.
- Keeps the creation flow easy to inspect in tests and docs.

**`contracts/delayed-self-message`**
- A delayed self-message pattern for scheduling internal follow-up work.
- Shows how to invalidate stale delayed messages with a versioned payload.

**`contracts/signless-gasless`**
- A session-based delegation example for Sails programs.
- Covers allowlisted actions, session expiration, and both signature and no-signature creation flows.

**`contracts/module-toggles/oracle`**
- A minimal reusable oracle module with no embedded policy.

**`contracts/module-toggles/oracle-admin-wrapper`**
- A composition example that wraps the base oracle with admin-only writes and exposes a consumer `Market` service.
- Demonstrates `extends`, selective override, and isolated storage per module.

### Frontend patterns

**`frontend/patterns/hooks`**
- Transaction preparation, execution, and verified execution with Gear JS / React Query.

**`frontend/patterns/providers`**
- Reusable provider composition patterns for API, account, alerts, and query management.

**`frontend/patterns/ez-transactions`**
- A higher-level signless + gasless integration flow for frontend apps.

### Infrastructure patterns

**`infrastructure/gateway`**
- A REST gateway that exposes Sails programs through a conventional HTTP API.

**`infrastructure/gasless-server`**
- A voucher-management backend for gasless UX.

**`infrastructure/token-gate-server`**
- A token-gated authentication server based on signed wallet messages and on-chain VFT balance checks.

---

## Prerequisites

- **Rust** `1.91+` (the examples use `edition = 2024`)
- `cargo`
- recommended target:
  ```bash
  rustup target add wasm32v1-none
  ```

> Some patterns depend on Sails build tooling (`sails-rs` build feature), which generates IDL and client artifacts at build time.

---

## How to build and test

Most contract patterns are self-contained, so run commands from the pattern directory.

### Build
```bash
cd contracts/<pattern>
cargo build --release
```

### Run tests (gtest)
```bash
cd contracts/<pattern>
cargo test
```

---

## How to use these patterns in your project

Recommended workflow:

1. Pick the closest reference for the problem you are solving.
2. Start from the pattern README before copying code.
3. Keep the same discipline:
   - clear error types,
   - explicit storage ownership,
   - deterministic integer math,
   - tests for the critical path,
   - documentation for any non-obvious runtime behavior.

Patterns are intentionally small, so some production concerns are left explicit rather than abstracted away. That is a feature: the repo is meant to teach the moving parts, not hide them.

---

## Contributing

Contributions are welcome.

If you want to add a new pattern:
- keep it minimal (one idea per folder),
- include a short README that explains the purpose and call flow,
- include at least one gtest integration test when possible,
- prefer stable ABI patterns (typed errors instead of `String`).

---

## Security note

These examples are educational and engineering-oriented.
They are **not audited** and should not be deployed to production as-is without review and adaptation.

---

## License

MIT
