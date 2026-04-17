# Factory Child Pattern

This contract is the intentionally minimal child program used by the factory example in [`../factory`](../factory/README.md).

It exists for one reason: to keep the factory flow easy to understand. The child constructor takes no custom arguments, and the service exposes one method:

- `do_something() -> String`

That makes it easier to focus on the interesting part of the factory pattern:
- how the parent program creates a child from `CodeId`,
- how the init payload is encoded,
- and how the parent waits for the initialization reply.

## Full code reference

- Program + service: [`app/src/lib.rs`](./app/src/lib.rs)
- Integration test: [`tests/gtest.rs`](./tests/gtest.rs)

## Why keep this example so small?

Because the factory pattern is already doing enough:
- upload child code,
- deploy the factory,
- ask the factory to create a child,
- observe the emitted event and returned address.

If the child program were also complex, it would be harder to see which part of the flow belongs to the factory and which part belongs to child business logic.

## Build

```bash
cargo build --release
```

## Test

```bash
cargo test
```
