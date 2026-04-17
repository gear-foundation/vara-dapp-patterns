# Verified Sign & Send

This pattern provides a **reliable and verifiable way to execute Vara extrinsics** from React applications.

Unlike basic `signAndSend` helpers, this hook guarantees that an operation was **actually successful at the program level**, not just accepted by the runtime.

It is designed for cases where **“extrinsic included” is not enough** and stronger correctness guarantees are required.

---

## Why this pattern exists

In the Gear / Vara ecosystem, an extrinsic can:

- Be successfully included in a block
- Emit `ExtrinsicSuccess`
- **Still fail at the program level** (e.g. reply error, insufficient gas, logic failure)

Most simple `signAndSend` utilities stop at runtime success and do not inspect:
- Gear `MessageQueued` events
- Program reply events
- Decoded reply error codes

This pattern closes that gap by **verifying real execution success**.

---

## What “verified” means

An operation is considered successful **only if all of the following are true**:

1. The extrinsic is included in a block (or finalized)
2. No `ExtrinsicFailed` event is emitted
3. All `gear.MessageQueued` events are collected
4. All corresponding reply events are fetched
5. No reply indicates a program-level error

If any of these steps fails, the mutation rejects with a meaningful error.

---

## Responsibilities

This pattern focuses exclusively on **execution and verification**.

It does **not**:
- Build program calls
- Map domain parameters to program arguments
- Decide gas limits

Those responsibilities belong to preparation patterns such as `prepare-program-tx` or your own transaction builder.

---

## API

```ts
useVerifiedSignAndSend({
  programs,
  resolveOn?,
  mutationOptions?,
})
```

## Input

This hook expects a **prepared extrinsic** (`SubmittableExtrinsic`).

Transaction building and argument mapping should happen in a separate pattern
(e.g. using `usePrepareProgramTransaction` or a custom builder hook).

## Output

The mutation resolves only after:
- runtime success (no `ExtrinsicFailed`)
- and program-level success (no error replies for queued messages)


## Parameters

- **`programs`**  
  A list of programs involved in the extrinsic execution.  
  Each entry must include:
  - **`programId`**
  - **`registry`** (used to decode reply errors)

  If a program is omitted from this list, runtime-level failures are still caught, but reply payloads for that program cannot be decoded into typed Sails errors.

- **`resolveOn` *(optional)***  
  Controls when the mutation resolves:
  - **`inBlock`** *(default)*: faster, resolves on block inclusion
  - **`finalized`**: stronger guarantee, resolves on finalization

- **`mutationOptions` *(optional)***  
  Standard React Query mutation options  
  (`onError`, `onSuccess`, retries, etc.)
