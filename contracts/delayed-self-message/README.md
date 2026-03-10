# Delayed Self Message Pattern

A minimal Vara / Sails pattern that shows how to schedule a **delayed self-message** and safely ignore **stale delayed messages**.

This example is intentionally small. It is meant to teach one idea:

> a delayed message may arrive after the state has already changed, so the handler must verify that the message is still relevant.

## What this pattern demonstrates

- scheduling a delayed message to the same program
- manually encoding a Sails request payload
- expiring temporary state after a number of blocks
- invalidating old delayed messages with a `version`
- rejecting external calls to an internal expiration method

## Why this matters

Delayed messages are useful for simple time-based automation:

- temporary locks
- reservation expiration
- session cleanup
- auction finalization
- cooldowns and unlock timers

The main pitfall is simple:

1. a program schedules a delayed message
2. the user changes the state before that message arrives
3. the old delayed message is still delivered later

If the handler executes blindly, it may corrupt valid state.

This pattern avoids that by storing a `version` in state and including the same `version` inside the delayed self-message payload.

## Pattern idea

Each user has a lock:

- `active` - whether the lock is currently active
- `expires_at` - block height when expiration is allowed
- `version` - incremented on every meaningful state change

When a lock is started or renewed:

1. the program schedules a delayed self-message: `Expire(user, version)`
2. the current lock state is saved with the same `version`

When the delayed message arrives, the program checks:

- the message was sent by the program itself
- the lock still exists
- the lock is still active
- the `version` in storage matches the `version` in the message
- the current block is at least `expires_at`

If any of these checks fails, the message is ignored.

## Flow

### Start

- user calls `start(delay_blocks)`
- program schedules delayed `Expire(user, version)`
- lock becomes active

### Renew

- user calls `renew(delay_blocks)`
- program increments `version`
- program schedules a new delayed `Expire(user, new_version)`
- old delayed messages become stale automatically

### Cancel

- user calls `cancel()`
- lock becomes inactive
- `version` is incremented
- previously scheduled delayed messages become stale

### Expire

- delayed self-message calls `expire(user, version)`
- program verifies the message is still valid
- if valid, lock is deactivated

## Request encoding

This example manually builds the payload for the delayed self-message.

A Sails request is encoded as:

1. service route
2. action name
3. encoded arguments

In this example:

```rust
fn encode_expire_request(user: ActorId, version: u64) -> Vec<u8> {
    let mut request = Vec::new();
    SERVICE_NAME.encode_to(&mut request);
    EXPIRE_ACTION.encode_to(&mut request);
    (user, version).encode_to(&mut request);
    request
}
```

Then the program schedules a delayed call to itself:
```rust
msg::send_bytes_with_gas_delayed(
    exec::program_id(),
    request,
    DELAY_GAS,
    0,
    delay_blocks,
)
```

## Contract API

### Commands

- `start(delay_blocks)` - create a new active lock and schedule expiration

- `renew(delay_blocks)` - replace the current timer with a new one

- `cancel()` - deactivate the lock and invalidate pending expirations

- `expire(user, version)` - internal method used by the delayed self-message

### Query

- `get_lock(user)` - return current lock state for a user

### Events

The pattern emits simple lifecycle events:

- `Started`

- `Renewed`

- `Cancelled`

- `Expired`

These are useful in tests and for understanding what happened.

## Key takeaway

This pattern is not about timers alone.

It teaches a safer rule:

> delayed messages should be treated as potentially stale, and their handler should verify that the message still matches current state.

## When to use this pattern

Use it when you need a small amount of block-based automation inside one program.

Good fits:

- expiring temporary permissions

- lock / cooldown expiration

- cleanup after a timeout

- simple deferred actions

## When not to use this pattern

This example is intentionally minimal.

It does not try to solve:

- recurring scheduling

- batching many delayed jobs efficiently

- cross-program compensation flows

- advanced gas reservation strategies

- production-grade scheduler abstractions

If you need those, build a more specialized pattern on top of this one.

## Summary

This pattern shows a minimal and practical approach to delayed self-messages in Vara:

- schedule a delayed message

- include a state version in the payload

- verify the version when the message arrives

- ignore stale messages safely

