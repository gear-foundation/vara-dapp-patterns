# Query Provider

This pattern defines a centralized React Query provider with a shared `QueryClient`
configuration tailored for Vara and blockchain-based applications.

---

## Why this pattern exists

Blockchain data is fundamentally different from typical REST APIs:

- State changes are explicit (transactions)
- Background refetching is often undesirable
- Data consistency should be controlled manually

This provider configures React Query to favor **predictability and explicit invalidation**
over automatic refetch behavior.

---

## Default configuration

```ts
{
  gcTime: 0,
  staleTime: Infinity,
  refetchOnWindowFocus: false,
  retry: false,
}
```

## Rationale

- **`staleTime: Infinity`**  
  Data is treated as always fresh until explicitly invalidated.

- **`gcTime: 0`**  
  Cached data is kept for the lifetime of the app.

- **`refetchOnWindowFocus: false`**  
  Prevents unexpected refetches when the user switches tabs.

- **`retry: false`**  
  Errors should be handled explicitly, not retried automatically.

---

## Usage

```tsx
import { QueryProvider } from '@/frontend/patterns/providers/query-provider/QueryProvider';

function AppProviders({ children }) {
  return <QueryProvider>{children}</QueryProvider>;
}
```

## Relationship with other provider patterns

This provider is usually placed after core Vara providers:

1. **API provider**
2. **Account provider**
3. **Alert provider**
4. **Query provider**
5. **Router / Theme / other app-level providers**
