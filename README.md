# vara-dapp-patterns

A curated collection of **production-oriented development patterns** for building smart contracts (smart programs) on the **Gear** ecosystem using **Sails**.

The goal of this repository is to provide **small, isolated, well-documented** examples that you can:
- read in one sitting,
- copy into real projects,
- extend into larger architectures,
- test locally with `gtest`.

> This repository is focused on **engineering patterns** (composition, access control, factories, sessions, client generation), not on a single end-user application.

---

## What this repo is for

This repo is useful if you are building smart programs on Gear/Vara and want ready-to-use examples for:

- **Service composition** (multiple modules in one program)
- **Access control wrappers** (extend a service and override specific methods)
- **Factories** (program deploys other programs on-chain)
- **Signless / gasless sessions** (delegated calls via session keys)
- Clean `no_std` storage wiring with `RefCell`
- Minimal integration testing with `sails-rs` + `gtest`

Each pattern aims to be:
- minimal but realistic,
- easy to audit,
- supported by tests and/or a guide.

---

## Repository structure

All examples live under:

```
contracts/
```

Each pattern is a **self-contained Cargo workspace**, typically structured like:

```
<pattern>/
  app/        # smart contract logic: Program + Services
  client/     # generated Rust client from IDL
  src/        # WASM export helpers (for tests)
  tests/      # gtest integration tests
  Cargo.toml
  README.md
```

---

## Included patterns

### 1) Factory
**Path:** `contracts/factory`

A minimal factory smart program that can **instantiate another program on-chain** from a pre-uploaded template `CodeId`.

Highlights:
- async program creation (`create_program_bytes_with_gas_for_reply(...).await`)
- clean error mapping for "start vs reply" phases

Docs:
- `contracts/factory/README.md`

---

### 2) Factory child program
**Path:** `contracts/factory-child`

A small child program intended to be deployed by the factory example.

---

### 3) Signless / Gasless sessions
**Path:** `contracts/signless-gasless`

A reference implementation of a session mechanism that allows a **session key** to execute a limited set of actions on behalf of an **original account**.

Highlights:
- delegated calls with allowlisted actions
- session expiration rules
- test coverage for signature / no-signature flows

Docs:
- `contracts/signless-gasless/README.md`

---

### 4) Module composition + admin wrapper (module-toggles WIP)
**Path:** `contracts/module-toggles`

This section is under active development. It currently contains:

- `oracle/` — a minimal reusable oracle module
- `counter-with-admin/` — a program that demonstrates:
  - service extension (`extends`)
  - selective method override (`update_price` guarded by admin)
  - a `Market` module consuming the oracle

The intention is to evolve this into a full **module toggles** example where modules can be enabled/disabled at runtime.

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

Since every pattern is self-contained, run commands from the pattern directory.

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

1) Pick the closest pattern:
   - `factory` for on-chain deployment
   - `signless-gasless` for delegated calls
   - `module-toggles` for modular composition + policy wrappers

2) Copy the relevant modules or structure into your codebase.

3) Keep the same discipline:
   - clear error types
   - minimal storage surface
   - deterministic integer math
   - integration tests for critical flows

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
