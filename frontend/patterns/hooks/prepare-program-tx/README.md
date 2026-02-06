# usePrepareProgramTx

## Problem

Preparing a Vara program transaction requires several coordinated steps:

- ensuring a program instance is available  
- validating that an account is connected  
- mapping UI parameters to program arguments  
- building a correct transaction object  

This logic is often repeated across components, leading to duplication and inconsistent behavior.

---

## Solution

`usePrepareProgramTx` encapsulates only the **transaction preparation phase** using Gear JS React Hooks.

It provides a reusable, declarative way to transform UI parameters into a ready-to-use transaction.

---

## Responsibilities

This hook is intentionally limited to:

- validating prerequisites  
- mapping input parameters  
- preparing a transaction via `usePrepareProgramTransaction`  
- exposing the prepared transaction and related state  

It does **not**:

- sign transactions  
- send transactions  
- manage side effects  
- depend on React Query  

---

## Usage

```tsx
const { prepare, canPrepare } = usePrepareProgramTx({
  program,
  serviceName,
  functionName,
  mapArgs: (params) => [params.to, params.amount],
});

const onClick = async () => {
  if (!canPrepare) return;

  const tx = await prepare({ to, amount });
  await tx.signAndSend();
};
```