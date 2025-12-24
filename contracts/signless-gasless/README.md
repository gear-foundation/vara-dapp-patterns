# Signless/Gasless Sessions (Sails / Gear): Guide and Integration Notes

This guide documents the **session system** used to support **delegated calls** (often described as *signless* and/or *gasless*) in Sails-based programs on the Gear/Vara ecosystem.

The session mechanism in this project provides an **authorization layer**: a designated **session key** may execute a restricted set of actions **on behalf of** an **original account** for a limited period of time.

## Full code references

- Program + example business service (counter): [`app/src/lib.rs`](./app/src/lib.rs)
- Session system macro usage: `generate_session_system!(ActionsForSession)` (from the [`session_service` crate](https://github.com/gear-foundation/signless-gasless-session-service))
- Tests (signature and no-signature flows): [`tests/`](./tests/gtest.rs)

---

## Core concepts

### Roles

- **Original account**  
  The account on whose behalf an operation is executed (the “real” user).

- **Session key (delegate)**  
  The account that is allowed to submit messages on behalf of the original account, restricted by:
  - expiration,
  - an allowlist of permitted actions.

### `session_for_account` parameter

Business methods that support sessions accept:

- `None`  
  The call is treated as a normal call. The original account equals `msg::source()`.

- `Some(account)`  
  The call is treated as delegated. The program verifies the session for `account` and resolves the original account accordingly.

### Allowed actions (allowlist)

The enum `ActionsForSession` defines which actions may be delegated. At runtime, session validation checks that the current action is included in the session’s `allowed_actions`.

### Expiration

Sessions expire in two ways:

- **Timestamp-based** (`expires`): rejected once `expires <= exec::block_timestamp()`.
- **Block-based** (`expires_at_block`): used to schedule delayed deletion (see below).

---

## What `generate_session_system!(ActionsForSession)` provides

The macro generates (at a minimum):

- **`SessionStorage`**
  - a `HashMap<ActorId, SessionData>` mapping **original account → session**
  - `SessionConfig` storage

- **`SessionService`**
  - `create_session(...)`
  - `delete_session_from_account()`
  - `delete_session_from_program(account)` (used by delayed self-message)
  - query helpers (list sessions, read session by account)

- **`SessionStorage::get_original_address(...)`**
  - the primary helper used by application logic to resolve and validate delegated calls

### How original address resolution works

Application logic typically:

1) reads `msg::source()` (the immediate sender)  
2) calls `get_original_address(...)` with:
   - `msg_source`
   - `session_for_account`
   - current action enum variant (e.g., `ActionsForSession::IncreaseCounter`)

If `session_for_account` is `Some(account)`, validation includes:

- a session exists for `account`
- the session is not expired
- `allowed_actions` contains the requested action
- `session.key == msg::source()` (the caller is the approved session key)

If all checks pass, `account` is returned as the resolved original address.

---

## Creating sessions: with signature vs without signature

The session service supports two creation modes that differ by **who submits the on-chain call** and whether an **off-chain signature** is required.

### 1) Signature-based creation

**Use case:** the original account authorizes a delegate off-chain; the delegate (or relayer) submits the on-chain `create_session` call.

**High-level behavior:**

- the transaction sender (`msg::source()`) becomes the **session key** (delegate)
- the session is created **for** the account specified by `signature_data.key`
- a signature is verified against a message constructed by the contract

**Why this is useful:** it enables “signless” UX, where the original account does not need to submit the on-chain transaction itself.

**Implementation note:** the signed message must match the contract’s expected format (including the `<Bytes>...</Bytes>` wrapper). If the signed bytes differ, verification fails.

### 2) No-signature creation

**Use case:** the original account directly creates the session on-chain and appoints a delegate.

**High-level behavior:**

- the transaction sender (`msg::source()`) is the **original account**
- `signature_data.key` is treated as the **session key** (delegate)
- no signature verification is performed

This mode is suitable when the user can call `create_session` directly (e.g., standard wallet flow).

---

## Session lifecycle: creation, usage, and deletion

### Creation

A session stores:

- `key`: approved session key (delegate)
- `expires`: timestamp-based expiration
- `allowed_actions`: action allowlist
- `expires_at_block`: block-height marker used for deletion scheduling

The service emits `SessionCreated` on successful creation.

### Usage in business methods

To support delegated calls, a business method should:

- accept `session_for_account: Option<ActorId>`
- call `get_original_address(...)` using the action being executed
- use the returned original address for authorization/accounting

### Deletion

The session system schedules an automatic deletion by sending a **delayed self-message** to the program. This is why `SessionConfig` includes:

- `gas_to_delete_session`
- `ms_per_block` (used to derive `expires_at_block` from the duration)

Manual deletion is also supported via `delete_session_from_account()`.

---

## Action binding requirements

The action passed into `get_original_address(...)` must correspond to the method being executed.

Example: if a session was created with `allowed_actions = [IncreaseCounter]`, then only methods validating with `ActionsForSession::IncreaseCounter` should succeed.

This is the mechanism that prevents a session key from calling unrelated privileged methods.

---

## Testing

This project typically includes two primary integration tests:

- **Signature-based session creation**: `create_session(..., Some(signature))` followed by a delegated call.
- **No-signature session creation**: `create_session(..., None)` followed by a delegated call where `msg::source()` is the session key.

---

## Development diagnostics

### Enable `sails-rs` debug feature

If you encounter errors during development or test execution and need more detailed diagnostics, enable the `debug` feature for `sails-rs`.

In `Cargo.toml`, replace:

```toml
sails-rs = "0.10.1"
```

with:

```toml
sails-rs = { version = "0.10.1", features = ["debug"] }
```

### Log underlying errors during mapping

When mapping runtime errors into typed enums, prefer logging the underlying error value instead of discarding it:

```rust
.map_err(|e| {
    sails_rs::gstd::debug!("operation failed: {:?}", e);
    /* map to your typed error */
})?;
```

This keeps ABI stable (typed errors) while still providing actionable diagnostics in development.

---

## Summary

Sessions provide a structured pattern for delegated execution:

- **With signature:** the original account authorizes a delegate off-chain.
- **Without signature:** the original account appoints a delegate on-chain.

Both modes rely on the same runtime validation in `get_original_address(...)`, enforcing:
expiration, allowlisted actions, and approved session key ownership.
