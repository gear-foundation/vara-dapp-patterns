# Vara Program Gateway (Sails-JS / Express)

A production-oriented **API gateway** that exposes Vara on-chain programs as a conventional REST API using the **Sails-JS** library.

The gateway pattern is useful when you need a trusted, server-side actor to interact with your contracts — for example: automated deployments, DEX pool creation, batch operations, or any flow where the user should not sign transactions themselves.

## Full code reference

- Configuration: [`src/config/constants.ts`](./src/config/constants.ts)
- Vara utilities: [`src/utils/vara.utils.ts`](./src/utils/vara.utils.ts)
- Contract service: [`src/services/contract.service.ts`](./src/services/contract.service.ts)
- Controllers: [`src/controllers/contract.controller.ts`](./src/controllers/contract.controller.ts)
- Routes: [`src/routes/contract.routes.ts`](./src/routes/contract.routes.ts)
- Auth middleware: [`src/middleware/auth.middleware.ts`](./src/middleware/auth.middleware.ts)
- Server entry: [`src/index.ts`](./src/index.ts)

---

## Core concepts

### API Gateway pattern

An API gateway translates between the HTTP world and the on-chain world. Clients send standard REST requests; the gateway signs and submits Substrate extrinsics, waits for program replies, and returns structured JSON responses.

This decouples frontend clients from the complexity of:
- managing a Polkadot API connection
- holding signing keys in the browser
- understanding SCALE encoding or IDL formats
- handling Substrate event subscriptions

### Sails-JS

Sails-JS is a TypeScript library that parses a Sails IDL (Interface Definition Language) file and generates a fully-typed fluent API for interacting with the corresponding Gear/Vara program.

After initialization:
```
sails.services.<ServiceName>.functions.<FunctionName>(args) → transaction
sails.services.<ServiceName>.queries.<QueryName>(args).call() → data
```

### `app.locals` as a dependency injection container

Rather than using module-level globals or a DI framework, this gateway stores shared resources in `app.locals` at startup:

```typescript
app.locals.api             = api;             // GearApi
app.locals.factorySails    = factorySails;    // Sails (factory contract)
app.locals.poolFactorySails = poolFactorySails; // Sails (pool factory)
app.locals.signer          = signer;          // KeyringPair
```

Controllers access them via `req.app.locals`. This approach:
- keeps startup and request-handling code clearly separated
- makes testing straightforward (swap `app.locals` in test setup)
- avoids circular imports and global state

---

## High-level architecture

```
HTTP Client
    │
    ▼
Express Server (class Server)
    │
    ├── Middleware: helmet, cors, json, request logger
    │
    ├── Routes: /api/*
    │       │
    │       └── ContractController
    │               │ reads req.app.locals (api, sails, signer)
    │               │
    │               └── ContractService (static methods)
    │                       │
    │    ┌──────────────────┴──────────────────────────────┐
    │    │                                                  │
    │    │  Commands (state mutations)                      │  Queries (read-only)
    │    │  sails.services.S.functions.F(args)             │  sails.services.S.queries.Q(args)
    │    │    .withAccount(signer)                         │    .call()
    │    │    .withValue(BigInt(ONE_VARA))                  │
    │    │    .calculateGas()                              │
    │    │    .signAndSend()                               │
    │    │    → { response }                               │
    │    │    → response() ← program reply                 │
    │    │                                                  │
    └────┴──────────────────────────────────────────────────┘
                          │
                    Vara Network
```

---

## Key fragment explained: Sails command call chain

Every state mutation follows this exact pattern:

```typescript
// 1. Build the transaction — no network call yet
const transaction = await sails.services.Service.functions
  .CreateProgram(initConfig)       // typed function call — encodes args as SCALE
  .withAccount(signer)             // attach the signing KeyringPair
  .withValue(BigInt(ONE_VARA))     // send 1 VARA with the message (activation deposit)
  .calculateGas();                 // estimate gas on-chain — network call #1

// 2. Sign and submit the extrinsic
const { response } = await transaction.signAndSend();  // network call #2

// 3. Wait for the program-level reply
const result = await response();  // blocks until the program replies
```

### What `calculateGas()` does

`calculateGas()` calls `api.program.calculateGas()` under the hood — it simulates the message execution on-chain and returns the minimum gas needed. This avoids hardcoding gas values which could become stale as the program evolves.

### What `response()` does

`signAndSend()` returns a `response` function. Calling it blocks until the Gear runtime delivers the program's reply message. This makes the asynchronous blockchain interaction feel synchronous from the gateway's perspective: `await response()` resolves with the decoded return value of the contract function.

### `ONE_VARA` — the activation deposit

```typescript
export const ONE_VARA = 1_000_000_000_000n;
```

The Gear runtime requires that certain transactions (program creation, pool creation) carry a minimum VARA balance to activate the newly created programs. `withValue(BigInt(ONE_VARA))` satisfies this requirement.

---

## Query vs Function calls

| Aspect | Function call (command) | Query call |
|--------|------------------------|------------|
| State change | Yes | No |
| Gas required | Yes (via `calculateGas`) | No |
| Signing required | Yes (via `withAccount`) | No |
| On-chain tx | Yes | No (simulated) |
| Sails API | `.functions.X(args).withAccount().calculateGas().signAndSend()` | `.queries.X(args).call()` |
| Example | `CreateProgram(config)` | `Admins()`, `GetPair(a,b)` |

---

## `sailsInstance` initialization

```typescript
export const sailsInstance = async (
  api: GearApi,
  contractId: HexString,
  idl: string
): Promise<Sails> => {
  // 1. Initialize the WASM-based IDL parser
  const parser = await SailsIdlParser.new();

  // 2. Create a Sails wrapper around the parser
  const sails = new Sails(parser);

  // 3. Attach the network connection
  sails.setApi(api);

  // 4. Set the target program address
  sails.setProgramId(contractId);

  // 5. Parse the IDL to build the typed service/function/query tree
  sails.parseIdl(idl);

  return sails;
};
```

Each Sails instance is bound to exactly one on-chain program. The gateway creates two instances (factory + pool factory) at startup and shares them across all request handlers.

---

## Composite operation: `createProgramAndPool`

```typescript
static async createProgramAndPool(...): Promise<{ programResponse, pairAddress }> {
  // Phase 1: deploy VFT program
  const programResponse = await this.createProgram(factorySails, signer, initConfig);
  const tokenAddress = programResponse.programCreated.address;

  // Brief delay for state propagation
  await new Promise(r => setTimeout(r, 2_000));

  // Phase 2: create pool for the new token
  const pairAddress = await this.createPoolWithRegisteredToken(
    factorySails, poolFactorySails, signer, tokenAddress, registeredToken
  );

  return { programResponse, pairAddress };
}
```

This demonstrates **on-chain operation composition**: the output of one contract call (a new program address) becomes the input of the next (pool creation). The 2-second delay between phases allows the Vara runtime to finalize the first transaction before the second reads from the registry.

---

## REST API reference

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `GET` | `/` | — | API discovery |
| `GET` | `/api/health` | — | Network connection status |
| `POST` | `/api/create-program` | `VftInitConfig` | Deploy a new VFT program |
| `POST` | `/api/create-pool` | `{token_a, token_b}` | Create liquidity pool |
| `POST` | `/api/create-pool-with-registered-token` | `{token, registered_token?}` | Pool with registered token |
| `POST` | `/api/create-program-and-pool` | `CreateProgramAndPoolInput` | Deploy + create pool |
| `GET` | `/api/admins` | — | Factory admin list |
| `GET` | `/api/id-to-address` | — | Program ID → address mapping |
| `GET` | `/api/number` | — | Total deployed programs |
| `GET` | `/api/registry` | — | Full program registry |
| `GET` | `/api/pool-factory-address` | — | Pool factory address |
| `GET` | `/api/pair-address?token_a=&token_b=` | — | Pair address for token pair |

---

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NETWORK` | ✅ | Vara WebSocket URL |
| `FACTORY_CONTRACT_ID` | ✅ | Factory program HexString |
| `FACTORY_IDL` | ✅ | Factory IDL content (string) |
| `POOL_FACTORY_CONTRACT_ID` | ✅ | Pool factory program HexString |
| `POOL_FACTORY_IDL` | ✅ | Pool factory IDL content (string) |
| `WALLET_NAME` | ✅ | Signer wallet name |
| `WALLET_MNEMONIC` | ✅ | Signer 12/24-word mnemonic |
| `PORT` | ❌ | HTTP port (default: `3000`) |
| `NODE_ENV` | ❌ | `development` or `production` |
| `ALLOWED_ORIGINS` | ❌ | CORS origins (default: `*`) |
| `API_KEY` | ❌ | API key for middleware (optional) |

---

## Build and run

```bash
yarn install
cp .env.example .env
# Fill in .env values
yarn dev      # development
yarn build && yarn start  # production
```

---

## Troubleshooting

### "calculateGas failed"

Usually means the contract function was called with wrong argument types or the program is not active. Verify:
1. `contractId` is correct and the program is deployed on the target network.
2. Argument types match the IDL exactly (e.g., `bigint` for `u128`, `string` for `ActorId`).
3. The signer account has enough VARA to cover the `withValue` amount + transaction fee.

### "response() times out"

The program may have panicked during execution. Enable Gear debug mode:
```typescript
// In createProgram — log the response before returning
const result = await response();
console.log("[debug] program response:", JSON.stringify(result));
```

### Pool pair address not found after creation

The 3-second delay in `createPoolWithRegisteredToken` may be insufficient on a loaded testnet. Increase the delay or implement polling with `getAllPairs()` until the new pair appears.

---

## Security notes

- **Never commit `WALLET_MNEMONIC`** to version control. Use environment secrets (Docker secrets, Render/Vercel env vars).
- Enable `authenticateApiKey` middleware in production to prevent unauthorized access to write endpoints.
- The gateway signer account should hold the minimum VARA balance needed for operations. Do not fund it excessively.
- Consider running the gateway behind an API gateway or reverse proxy (nginx, Cloudflare) that handles rate limiting and TLS.

---

## Summary

This pattern cleanly separates three concerns:

- **Infrastructure** (`Server` class): middleware, routing, lifecycle, shared resources in `app.locals`
- **Application logic** (`ContractService`): pure static methods, dependencies passed as parameters
- **HTTP translation** (`ContractController`): reads `req.app.locals`, calls service, serializes response

The Sails fluent chain (`.withAccount().withValue().calculateGas().signAndSend().response()`) is the key abstraction — it makes on-chain interactions feel like regular async function calls while handling SCALE encoding, gas estimation, and reply waiting transparently.
