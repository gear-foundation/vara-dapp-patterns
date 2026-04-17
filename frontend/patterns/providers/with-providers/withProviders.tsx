import {
  ApiProvider as GearApiProvider,
  AlertProvider as GearAlertProvider,
  AccountProvider as GearAccountProvider,
  type ProviderProps,
} from '@gear-js/react-hooks';
import type { ComponentType, PropsWithChildren } from 'react';

import type { AppRuntimeConfig } from './defaults';

/**
 * Pattern: Provider Composition (withProviders)
 *
 * This pattern centralizes application-wide providers (API, accounts, alerts, query client, router, theme, etc.)
 * into a single reusable wrapper.
 *
 * Why this matters:
 * - Keeps `main.tsx` / `App.tsx` clean
 * - Standardizes provider order
 * - Makes providers configurable and test-friendly
 */

type AnyProvider = ComponentType<PropsWithChildren>;

type WithProvidersOptions = {
  config: AppRuntimeConfig;

  /**
   * Optional providers from your app (e.g. QueryProvider, ThemeProvider, Router).
   * Each provider should accept `{ children }`.
   */
  extraProviders?: AnyProvider[];

  /**
   * Optional alert UI integration. If omitted, it falls back to the default Gear alert behavior.
   */
  alertTemplate?: ComponentType<any>;
  alertContainerClassName?: string;
};

function ApiProvider({ children, endpoint }: ProviderProps & { endpoint: string }) {
  return <GearApiProvider initialArgs={{ endpoint }}>{children}</GearApiProvider>;
}

function AccountProvider({ children, appName }: ProviderProps & { appName: string }) {
  return <GearAccountProvider appName={appName}>{children}</GearAccountProvider>;
}

function AlertProvider({
  children,
  template,
  containerClassName,
}: ProviderProps & { template?: ComponentType<any>; containerClassName?: string }) {
  // If no template is provided, GearAlertProvider still works with its defaults.
  return (
    <GearAlertProvider template={template} containerClassName={containerClassName}>
      {children}
    </GearAlertProvider>
  );
}

export function createWithProviders({
  config,
  extraProviders = [],
  alertTemplate,
  alertContainerClassName,
}: WithProvidersOptions) {
  const providers: AnyProvider[] = [
    // Core Gear/Vara providers first
    ({ children }) => <ApiProvider endpoint={config.nodeEndpoint}>{children}</ApiProvider>,
    ({ children }) => <AccountProvider appName={config.appName}>{children}</AccountProvider>,
    ({ children }) => (
      <AlertProvider template={alertTemplate} containerClassName={alertContainerClassName}>
        {children}
      </AlertProvider>
    ),

    // App-specific providers (Query, Router, Theme, etc.)
    ...extraProviders,
  ];

  return function withProviders(Component: ComponentType) {
    return function Wrapped() {
      return providers.reduceRight(
        (children, Provider) => <Provider>{children}</Provider>,
        <Component />,
      );
    };
  };
}
