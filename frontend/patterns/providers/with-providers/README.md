# Provider Composition (withProviders)

This pattern centralizes application-wide React providers into a single reusable wrapper.

It is especially useful in Vara dApps where multiple global providers are commonly needed:
- Gear API provider (node endpoint)
- Account provider (wallet connection + app name)
- Alert provider (UI notifications)
- App-specific providers (React Query, Router, Theme, etc.)

---

## Why this pattern exists

As applications grow, `main.tsx` / `App.tsx` often becomes cluttered:

- Providers scattered across files
- Inconsistent provider ordering
- Harder testing (no single place to configure the environment)

This pattern solves it by:
- defining a consistent provider stack
- allowing configuration via a single object
- making provider composition reusable and test-friendly

---

## API

```ts
const withProviders = createWithProviders({
  config: {
    nodeEndpoint: 'wss://...',
    appName: 'My Vara App',
  },
  extraProviders: [QueryProvider, ThemeProvider, BrowserRouter],
  alertTemplate: Alert,
  alertContainerClassName: alertStyles.root,
});

export default withProviders(App);
```

## Key design points

### Provider order matters

A recommended order is:

1. **API provider** (network connection)
2. **Account provider** (wallet state)
3. **Alert provider** (UX feedback)
4. **App-level providers** (Query, Router, Theme, etc.)

This keeps core Vara dependencies available early.
