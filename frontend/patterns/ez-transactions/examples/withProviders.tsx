import { ComponentType } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiProvider, AlertProvider, AccountProvider } from "@gear-js/react-hooks";
import { EzTransactionsProvider } from "gear-ez-transactions";

/// The Vara network WebSocket URL injected at build time.
const NODE_ADDRESS = import.meta.env.VITE_NODE_ADDRESS as string;

/// The gasless backend URL used by EzTransactionsProvider to request vouchers.
const GASLESS_BACKEND = import.meta.env.VITE_GASLESS_BACKEND_URL as string;

const queryClient = new QueryClient();

/// withProviders
///
/// A Higher-Order Component that wraps the application tree with all
/// global providers required for a Vara dApp using ez-transactions.
///
/// Provider order matters — each provider may depend on the context
/// provided by the outer ones:
///
///   QueryClientProvider   — React Query: caching, fetching, invalidation
///     ApiProvider         — Gear/Vara API WebSocket connection
///       AccountProvider   — Polkadot wallet connection + account state
///         AlertProvider   — App-wide alert/notification system
///           EzTransactionsProvider — signless + gasless session management
///             App
///
/// EzTransactionsProvider must be inside ApiProvider and AccountProvider
/// because it reads the API and account state on initialization.
export function withProviders<T extends object>(
  WrappedComponent: ComponentType<T>
) {
  return function WithProviders(props: T) {
    return (
      <QueryClientProvider client={queryClient}>
        <ApiProvider initialArgs={{ endpoint: NODE_ADDRESS }}>
          <AccountProvider>
            <AlertProvider>
              <EzTransactionsProvider
                backendAddress={GASLESS_BACKEND}
                allowedActions={[]}
              >
                <WrappedComponent {...props} />
              </EzTransactionsProvider>
            </AlertProvider>
          </AccountProvider>
        </ApiProvider>
      </QueryClientProvider>
    );
  };
}
