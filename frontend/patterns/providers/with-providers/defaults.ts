export type AppRuntimeConfig = {
  nodeEndpoint: string;
  appName: string;
};

export const DEFAULT_RUNTIME_CONFIG: AppRuntimeConfig = {
  nodeEndpoint: 'wss://example-node',
  appName: 'Vara App',
};
