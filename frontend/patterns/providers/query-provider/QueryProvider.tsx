import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';

/**
 * QueryClient configuration for application-wide data fetching.
 *
 * This configuration favors:
 * - deterministic data (no background refetches)
 * - full control over when queries are invalidated
 * - predictable UX for blockchain-based data
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 0,
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

/**
 * Pattern: Query Provider
 *
 * Wraps the application with a shared React Query client.
 */
export function QueryProvider({ children }: PropsWithChildren) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
