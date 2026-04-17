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

- **Resolved account**  
  The account returned by `get_original_address(...)` and used by business logic for authorization/accounting.

- **Immediate caller**  
  The current `msg::source()`, that is, the actor submitting the message right now.

- **Stored session key**  
  The delegate recorded inside `SessionData.key`. Validation checks that `SessionData.key == msg::source()` for delegated calls.

### `session_for_account` parameter

Business methods that support sessions accept:

- `None`  
  The call is treated as a normal call and resolves to `msg::source()`.

- `Some(account)`  
  The call is treated as delegated. The program loads the session stored under `account`, validates it, and if successful returns that same `account` as the resolved address.

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
- `session.key == msg::source()` (the caller matches the stored delegate)

If all checks pass, `account` is returned as the resolved original address.

---

## Creating sessions: with signature vs without signature

The session service supports two creation modes that differ by **who submits the on-chain call** and whether an **off-chain signature** is required.

### 1) Signature-based creation

**Use case:** one account signs an off-chain authorization, and the on-chain caller submits `create_session(...)` using that signature.

**Important nuance for this example:** the implementation stores the session under `signature_data.key`, and the signed payload authorizes the current `msg::source()` to become the stored delegate for that account.

That means the signature-based test in this repository behaves as follows:

- `signature_data.key` is the account under which the session is stored,
- the signed message contains `msg::source()` as the approved delegate,
- after creation, delegated business calls pass `Some(signature_data.key)`.

This is slightly less intuitive than the no-signature flow, so it is worth reading together with [`tests/gtest.rs`](./tests/gtest.rs) if you plan to adapt it.

**Implementation note:** the signed message must match the contract’s expected format exactly, including the `<Bytes>...</Bytes>` wrapper. If the bytes differ, verification fails.

### 2) No-signature creation

**Use case:** the account that wants to be represented on-chain directly creates the session and appoints a delegate.

**High-level behavior:**

- the transaction sender (`msg::source()`) becomes the account under which the session is stored
- `signature_data.key` becomes the stored delegate (`SessionData.key`)
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
- use the returned address for authorization/accounting instead of assuming `msg::source()` is the business owner

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

This project includes two important integration tests:

- **Signature-based creation**: demonstrates the exact semantics implemented by the current macro-backed service.
- **No-signature creation**: demonstrates the more direct "account appoints delegate" flow.

If you are integrating this pattern into a real product, treat these tests as the source of truth for role mapping.

---

## Development diagnostics

### Enable `sails-rs` debug feature

If you encounter errors during development or test execution and need more detailed diagnostics, enable the `debug` feature for `sails-rs`.

In `Cargo.toml`, replace:

```toml
sails-rs = "0.10.2"
```

with:

```toml
sails-rs = { version = "0.10.2", features = ["debug"] }
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
