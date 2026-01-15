# Admin Wrapper + Service Composition (Sails Pattern)

This example demonstrates a practical **module composition** pattern for Gear/Sails smart contracts:

1. **Reusable module**: a minimal `OracleService` that stores a price (`u128`) and exposes `update_price()` + `get_price()`.
2. **Wrapper/extension**: an `AdminOracle` service that **extends** the base oracle and **overrides only one method** (`update_price`) to inject **access control**.
3. **Consumer module**: a `MarketService` that **depends on** the oracle (reads the price) and maintains its **own independent state**.

It is a clean example of:
- service extension (`extends`)
- selective method override
- service composition (one service calling another)
- stable `no_std` storage wiring with `RefCell`

---

## Why this pattern is useful

In real protocols you often need:

- a shared module (oracle, registry, treasury, whitelist, limits)
- restricted writes (admin / multisig)
- multiple consumer services reading shared state
- the ability to add policy **without editing the original module**

This example shows how to do that cleanly in Sails.

---

## High-level architecture

**Program state** (owned by `Program`):

- `oracle: RefCell<u128>` — shared storage for the oracle
- `market: RefCell<MarketStorage>` — independent market state
- `admin: ActorId` — admin address stored at init

**Exposed services**:

- `admin_oracle()` → `Service<'_>` (admin-gated oracle wrapper)
- `market()` → `MarketService<'_>` (consumer module that uses oracle)

### Call flow

```
User
 │
 ├─ AdminOracle.update_price(value)  ──► requires msg::source() == admin
 │        │
 │        └─ writes Program.oracle storage
 │
 └─ Market.quote_usd(amount_tokens)  ──► reads oracle price
          │
          └─ Market.open_position(...) also writes MarketStorage
```

---

## Folder structure

```
module-toggles/
  oracle/                      # reusable oracle module (library crate)
  oracle-admin-wrapper/
    app/                       # smart-contract logic (Program + services)
    client/                    # generated Sails client from IDL
    src/                       # wasm binary export helpers for tests
    tests/gtest.rs             # integration tests (added in this pattern)
```

---

## The reusable module: `oracle/`

The oracle module is intentionally minimal.

**Storage model**
- one `u128` value stored inside a `RefCell`

**API**
- `update_price(new_price: u128)`
- `get_price() -> u128`

This module is reusable because it does **not** enforce policy (admin checks, signature checks, etc.).
Policy is injected in the next step via a wrapper.

---

## Admin wrapper (extends + override)

Inside `oracle-admin-wrapper/app/src/services/admin/mod.rs` you have:

- `Service<'a>` which holds:
  - `oracle: OracleService<'a>`
  - `admin: ActorId`

The key part is the **extension**:

- `#[sails_rs::service(extends = [OracleService<'a>])]`

And the **override**:

- `update_price(value)` now returns `Result<(), AdminError>`
- it checks caller first (`ensure_admin()`)
- then updates oracle storage

### Why override only one method?

Because it keeps the base module clean and reusable:
- base oracle has no opinion about who may write
- wrapper enforces the local policy (admin-only)

If later you want a different policy (multisig, signature proofs, committee voting), you can create a new wrapper without rewriting oracle.

---

## Market service (service composition)

`MarketService` demonstrates **composition**: it depends on `AdminOracle` and calls it internally.

Market maintains its own storage:

```rust
pub struct MarketStorage {
    pub last_quote_usd: u128,
    pub last_trader: ActorId,
}
```

Market provides three methods:

### `quote_usd(amount_tokens) -> Result<u128, MarketError>`
- reads current oracle price
- fails if oracle price is `0`
- computes quote using integer scaling

### `open_position(amount_tokens, max_acceptable_price) -> Result<u128, MarketError>`
- reads current oracle price
- validates:
  - price must be non-zero
  - price must be <= `max_acceptable_price` (slippage guard)
- writes market state:
  - `last_quote_usd`
  - `last_trader = msg::source()`

### `last_quote() -> (u128, ActorId)`
- reads and returns persisted market state

---

## Price scaling

This example uses a fixed integer scale:

- `PRICE_SCALE = 1e18`

Meaning:
- a “human” price like `5.0 USD` is represented as `5 * 1e18`

Quote calculation:

```
quote_usd = amount_tokens * price / PRICE_SCALE
```

This keeps math deterministic and `no_std` friendly.

---

## Deployment behavior: who becomes admin?

In `Program::new()`:

- `admin = msg::source()`

So the deployer of the program becomes the admin.

If you want upgradeable admin rotation, you would add:
- `set_admin(new_admin)` admin-only method
- events to track changes

---

## Building

From the example directory:

```bash
cd contracts/module-toggles/oracle-admin-wrapper
cargo build --release
```

`build.rs` builds WASM and generates an IDL.

---

## Running tests (gtest)

From the same folder:

```bash
cargo test
```

What tests cover:

- admin can update oracle price
- non-admin cannot update price
- `quote_usd()` works after setting price
- `open_position()` persists state and checks slippage
- failed `open_position()` does not mutate market state

---

## Notes about `#[export(unwrap_result)]`

Methods like `update_price()`, `quote_usd()`, and `open_position()` are exported with:

- `#[export(unwrap_result)]`

This pattern is convenient because:
- internally you can use `Result` and `?`
- externally the ABI stays simple (call fails on error)

In gtest, this becomes:
- `Ok(..)` → successful call
- `Err(..)` → the client receives a failed call (`is_err()`)

---

## Summary

This example is a compact, production-relevant Sails pattern:

- keep core modules reusable
- inject policy via wrappers (extends + override)
- compose services inside one Program
- isolate storage per module using `RefCell`

Use it as a baseline for:
- admin-gated protocol controls
- feature flags / module toggles
- oracle-based trading primitives
