# Factory Pattern (Sails / Gear): Minimal Guide

This repository contains a minimal **factory smart program** that can **instantiate (deploy) another program** on-chain from a pre-uploaded template **CodeId**.

## Full code reference

- Factory implementation: [`app/src/lib.rs`](./app/src/lib.rs)

## Key fragment explained (create + await reply)

The core of the factory is this flow:

```rust
let create_program_future = ProgramGenerator::create_program_bytes_with_gas_for_reply(
    code_id,
    payload,
    10_000_000_000,
    0,
    10_000_000_000,
)
.map_err(|_e| FactoryError::CreateProgramStartFailed)?;

let (address, _reply_bytes) = create_program_future
    .await
    .map_err(|_e| FactoryError::CreateProgramReplyFailed)?;
```

### What `create_program_bytes_with_gas_for_reply(...)` does

This call submits a request to the Gear runtime to **instantiate a new program** from the template identified by `code_id` and to **execute its initialization** with `payload`. The API returns a **Future** which resolves only after the runtime delivers the **initialization reply** back to the factory, at which point the factory receives the newly created program address.

In other words, the Future encapsulates the end-to-end lifecycle of:
- program creation (from `CodeId`),
- child program initialization (with the provided payload),
- delivery of the reply to the factory.

### Parameters

- `code_id`  
  Template identifier of the child program (must be uploaded beforehand).

- `payload`  
  Initialization payload for the child program, typically **SCALE-encoded constructor arguments**.  
  This must match the child’s `new(...)` signature; otherwise the child init will fail during `.await`.

  In this example the child constructor has no custom arguments, so the payload is just the encoded Sails constructor route:

  ```rust
  let payload = "New".encode();
  ```

- `gas_limit` - **gas for create + init**  
  Gas budget used to create the program and execute the child initialization.

- `value`  
  Value transferred to the created program (0 in this example).

- `reply_deposit` - **gas for reply**  
  Gas reserved for receiving/processing the reply message back in the factory.

### Why there are two different error mappings

There are two distinct failure phases:

1) **Start phase (immediate, before `await`)**

```rust
.map_err(|_e| FactoryError::CreateProgramStartFailed)?;
```

This captures failures that occur **immediately** when submitting the creation request (e.g., invalid `code_id`, runtime rejects the request, insufficient constraints for starting the operation).

2) **Reply phase (asynchronous, during `await`)**

```rust
.await
.map_err(|_e| FactoryError::CreateProgramReplyFailed)?;
```

This captures failures that happen **after the request is accepted**, while waiting for the child program to initialize and reply (e.g., child panicked/trapped during `new(...)`, reply gas too low, init execution fails).

### What `(address, _reply_bytes)` means

On success, the future resolves with:

- `address`: `ActorId` of the newly created child program instance (its on-chain address)
- `_reply_bytes`: reply payload bytes from the child (unused in the minimal example)

## Build

```bash
cargo build --release
```

## Test

```bash
cargo test --release
```

## Troubleshooting: enable Sails debug logs for tests

If you encounter test failures while developing your application and need more detailed diagnostics, enable the debug feature for sails-rs.

In `Cargo.toml`, replace:

```toml
sails-rs = "0.10.2"
```

with:

```toml
sails-rs = { version = "0.10.2", features = ["debug"] }
```

Then, instead of discarding the underlying error value `e`, log it with `sails_rs::gstd::debug!()` while keeping your typed error mapping:

```rust
let create_program_future = ProgramGenerator::create_program_bytes_with_gas_for_reply(
    code_id,
    payload,
    10_000_000_000,
    0,
    10_000_000_000,
)
.map_err(|e| {
    sails_rs::gstd::debug!("create_program start failed: {:?}", e);
    FactoryError::CreateProgramStartFailed
})?;

let (address, _) = create_program_future
    .await
    .map_err(|e| {
        sails_rs::gstd::debug!("create_program reply failed: {:?}", e);
        FactoryError::CreateProgramReplyFailed
    })?;
```

## Notes

- The child initialization payload must match the child constructor exactly: route first, then SCALE-encoded arguments in order. For a constructor such as `new(name: String, cfg: Config)`, the payload would be built as:

```rust
let payload = ["New".encode(), name.encode(), cfg.encode()].concat();
```

- When a program instance is created, 1_000_000_000_000 units (1 VARA) are transferred from the creator and credited to the newly created program’s balance. This transfer is required to activate the program upon deployment, as an active program must hold a minimum balance to be considered operational by the runtime.
