# useProgramTxMutation

## Problem

After a transaction is prepared, dApps still need a consistent way to:

- execute it (sign + send)
- manage loading / success / error states
- integrate with React Query callbacks (onSuccess/onError/retries)

This logic is often duplicated across UI components.

---

## Solution

`useProgramTxMutation` is a thin React Query wrapper that executes a **prepared**
transaction via `signAndSend()`.

It intentionally does not prepare transactions and does not verify success.
Those concerns belong to other patterns.

---

## Responsibilities

This hook:

- executes a prepared transaction
- exposes React Query mutation state
- supports standard mutation callbacks

It does **not**:

- build/prepare transactions
- map UI params to args
- verify chain events or program replies

---

## Usage

```tsx
const execute = useProgramTxMutation();

const onClick = async () => {
  const tx = await prepare(params);
  await execute.mutateAsync(tx);
};
```