# Oracle Module

This folder contains the smallest reusable building block in the `module-toggles` examples: a plain oracle service that stores and returns one price.

## What it demonstrates

- a minimal reusable Sails service,
- storage passed in from the parent program,
- a module with **no embedded policy**.

The last point is the important one. `OracleService` does not decide:
- who is allowed to update the price,
- what validations should run,
- which downstream services may read it.

That policy is intentionally left to wrappers such as [`../oracle-admin-wrapper`](../oracle-admin-wrapper/README.md).

## API

- `update_price(new_price: u128)`
- `get_price() -> u128`

## Full code reference

- Module implementation: [`src/lib.rs`](./src/lib.rs)

## Why this matters

Keeping the base module policy-free makes it easier to:
- reuse it in different programs,
- wrap it with different authorization strategies,
- test composition separately from business rules.

That is the core idea behind the `oracle-admin-wrapper` example: keep the storage and behavior reusable, then inject local policy with `extends` and selective overrides.
