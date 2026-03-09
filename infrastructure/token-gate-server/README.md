# Token-Gate Server (Gear / Vara)

A production-oriented **authentication and access-control server** for Vara dApps that gates access based on on-chain **VFT (Vara Fungible Token) balance**.

The pattern implements a Vara-native variant of **Sign-In With Wallet (SIWE)**: the user signs a structured message with their Polkadot wallet, the server verifies the signature and on-chain balance, then issues a **JWT** for session management. Downstream services verify the JWT — no on-chain query needed per request.

## Full code reference

- Auth primitives (nonce, JWT, signature): [`src/auth.ts`](./src/auth.ts)
- On-chain VFT balance reader: [`src/gear.ts`](./src/gear.ts)
- Sails-JS VFT client (generated): [`src/vft.ts`](./src/vft.ts)
- Express server + all endpoints: [`src/server.ts`](./src/server.ts)
- Environment template: [`.env.txt`](./.env.txt)

---

## Core concepts

### Token Gating

Token gating restricts access to content or features to accounts that hold at least a minimum balance of a specific token. The gate is enforced server-side at authentication time: if `balance < threshold`, the server returns `403 Forbidden` and no JWT is issued.

### Sign-In With Wallet (SIWE) for Vara

The Vara variant of SIWE uses **Polkadot/Substrate cryptography** (sr25519 or ed25519) instead of Ethereum's secp256k1. The flow:

1. Client requests a **nonce** from the server.
2. Client builds a structured **signed message** that embeds the nonce, domain, and timestamp.
3. Client signs the message with their wallet (e.g., Polkadot.js extension).
4. Server verifies: nonce validity, domain/chainId, message freshness, and signature.
5. Server queries VFT balance on-chain. Issues JWT if threshold is met.

### Nonce challenge-response

The nonce prevents **pre-signed message replay attacks**: an attacker cannot reuse a captured signed message because the nonce is single-use and expires.

### JWT lifecycle

```
          issue (20 min)
 /auth/verify ──────────────────────────────►  JWT (exp: T+20min)
                                                    │
                                          check every request
                                                    │
                              ┌─────────────────────▼──────────────────────┐
                              │  remain > REFRESH_MIN_REMAIN_SEC (5min)?   │
                              │  → return same JWT (no refresh yet)        │
                              └─────────────────────┬──────────────────────┘
                                                    │ remain <= 5min
                                          /auth/refresh
                                                    │
                              ┌─────────────────────▼──────────────────────┐
                              │  RECHECK_ON_REFRESH?                       │
                              │  → re-query VFT balance on-chain           │
                              │  → 403 if balance dropped below threshold  │
                              └─────────────────────┬──────────────────────┘
                                                    │ balance OK
                                              new JWT issued
```

---

## Authentication flow

```
Client (browser/dApp)          Token-Gate Server          Vara Network
         │                            │                        │
         │── POST /auth/nonce ────────►│                        │
         │◄── { nonce, expiresIn } ───│                        │
         │                            │                        │
         │  [user signs message]      │                        │
         │  Message format:           │                        │
         │    Nonce: <uuid>           │                        │
         │    Domain: myapp.com       │                        │
         │    ChainId: vara           │                        │
         │    IssuedAt: <ISO 8601>    │                        │
         │    ExpiresIn: 600s         │                        │
         │                            │                        │
         │── POST /auth/verify ───────►│                        │
         │   { address,               │── getVFTBalance() ────►│
         │     message,               │◄── balance: bigint ────│
         │     signature }            │                        │
         │                            │  [apply threshold]     │
         │◄── { jwt, balance,         │  balance >= threshold  │
         │      threshold }           │  → signJwt()           │
         │                            │                        │
         │── GET /protected ──────────►│                        │
         │   Authorization: Bearer jwt│                        │
         │◄── 200 OK ─────────────────│                        │
         │                            │                        │
         │── POST /auth/refresh ──────►│                        │
         │   Authorization: Bearer jwt│  [remain <= 5min]      │
         │                            │── getVFTBalance() ────►│ (if RECHECK)
         │◄── { jwt, refreshed: true }│                        │
```

---

## Key fragment explained: `POST /auth/verify`

The verify endpoint is the security-critical path. Each step is intentional:

```typescript
// Step 1: Validate request shape with Zod before any crypto
const { address, message, signature } = SignedMessageSchema.parse(req.body);

// Step 2: Extract structured fields from the signed message
const nonce     = mustExtract(message, "Nonce");
const domain    = mustExtract(message, "Domain");
const issuedAt  = mustExtract(message, "IssuedAt");
const expiresIn = mustExtract(message, "ExpiresIn");

// Step 3: Consume nonce — delete-on-read prevents replay
if (!consumeNonce(nonce)) {
  return sendError(res, 400, "Invalid or expired nonce");
}

// Step 4: Domain/ChainId binding (optional but recommended in production)
if (EXPECTED_DOMAIN && domain !== EXPECTED_DOMAIN) {
  return sendError(res, 400, "Invalid domain");
}

// Step 5: Timestamp freshness — prevents delayed submission attacks
if (!isMessageFresh(issuedAt, expiresIn, CLOCK_SKEW_MS)) {
  return sendError(res, 400, "Message expired or timestamp invalid");
}

// Step 6: Cryptographic signature verification
if (!verifySignature(address, message, signature)) {
  return sendError(res, 401, "Invalid signature");
}

// Step 7: On-chain balance check — the actual gate
const balRaw = await getVFTBalance(address, api);
if (toSafeBigInt(balRaw) < thresholdRaw) {
  return res.status(403).json({ error: "Insufficient token balance", ... });
}

// Step 8: Issue JWT
const token = signJwt(address, JWT_TTL_MIN, JWT_SECRET);
```

### Why Zod validation first?

Zod parsing rejects malformed requests before any expensive operation (crypto, network). It also prevents prototype pollution and type confusion attacks on `req.body`.

### Why `consumeNonce` before signature verification?

Consuming the nonce first ensures it cannot be reused even if the subsequent verification fails. An attacker who intercepts a valid `{address, message, signature}` tuple cannot retry it with the same nonce.

### Why `isMessageFresh` with clock skew?

A 2-minute clock skew tolerance (`CLOCK_SKEW_MS`) accommodates legitimate clients whose system clocks are slightly off. The `expiresIn` field in the signed message gives the user-declared TTL (typically 600 seconds). Both the issued time and the expiry are validated together to prevent backdated messages.

---

## Signed message format

The client must construct and sign a message with this exact structure (newline-separated key-value pairs):

```
Sign in to MyApp

Nonce: 3f2504e0-4f89-11d3-9a0c-0305e82c3301
Domain: myapp.com
ChainId: vara
IssuedAt: 2025-01-01T12:00:00.000Z
ExpiresIn: 600s
```

Fields:
| Field | Description |
|-------|-------------|
| `Nonce` | UUID from `POST /auth/nonce` |
| `Domain` | Application domain (must match `EXPECTED_DOMAIN` if set) |
| `ChainId` | Network identifier (must match `EXPECTED_CHAIN_ID` if set) |
| `IssuedAt` | ISO 8601 timestamp at message creation |
| `ExpiresIn` | Duration string: `600s`, `10m`, or `1h` |

---

## Why `RECHECK_ON_REFRESH`?

Without re-checking, a user who sells or transfers all their tokens can keep using the application indefinitely until their JWT expires. With `RECHECK_ON_REFRESH=true`, the server re-queries the VFT balance every time the JWT is refreshed. If the balance has dropped below the threshold, the renewal is denied and the user is effectively logged out at the next refresh cycle (within `JWT_TTL_MIN` minutes).

This provides **soft real-time revocation** without requiring the server to maintain a blocklist.

---

## REST API reference

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| `GET`  | `/health` | — | — | `{ ok, time, rpc }` |
| `POST` | `/auth/nonce` | — | — | `{ nonce, expiresIn }` |
| `POST` | `/auth/verify` | — | `{ address, message, signature }` | `{ jwt, balance, threshold, decimals }` |
| `POST` | `/auth/refresh` | Bearer JWT | — | `{ jwt, remainingSec, refreshed }` |
| `GET`  | `/entitlement` | Bearer JWT | — | `{ ok, address, hasAccess }` |

### Error responses

| Code | Meaning |
|------|---------|
| `400` | Bad request (invalid nonce, malformed message, expired timestamp) |
| `401` | Unauthorized (invalid or missing JWT / signature) |
| `403` | Token balance below threshold |
| `500` | Internal server error |

---

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JWT_SECRET` | ✅ | — | JWT signing secret (min 32 chars in production) |
| `VARA_WS` | ✅ | — | Vara network WebSocket URL |
| `VFT_PROGRAM_ID` | ✅ | — | HexString of the VFT contract |
| `VFT_DECIMALS` | ❌ | `0` | Token decimals |
| `VFT_THRESHOLD` | ❌ | `3000` | Minimum balance in human units |
| `EXPECTED_DOMAIN` | ❌ | `""` | Expected domain in signed message |
| `EXPECTED_CHAIN_ID` | ❌ | `""` | Expected chainId in signed message |
| `ALLOWED_ORIGINS` | ❌ | `*` | Comma-separated CORS allowed origins |
| `NONCE_TTL_SEC` | ❌ | `600` | Nonce expiry in seconds |
| `JWT_TTL_MIN` | ❌ | `20` | JWT validity in minutes |
| `REFRESH_MIN_REMAIN_SEC` | ❌ | `300` | Seconds remaining before refresh is allowed |
| `RECHECK_ON_REFRESH` | ❌ | `true` | Re-check VFT balance on JWT refresh |
| `CLOCK_SKEW_MS` | ❌ | `120000` | Clock skew tolerance in milliseconds |
| `PORT` | ❌ | `3000` | HTTP listen port |

---

## Build and run

```bash
# Install dependencies
yarn install

# Configure environment
cp .env.txt .env
# Edit .env with your values

# Development (hot reload)
yarn dev

# Production
yarn build
yarn start
```

---

## Troubleshooting

### "Invalid signature"

- Confirm the client signs the raw message string, not a hash of it.
- `@polkadot/util-crypto` `signatureVerify` accepts both sr25519 and ed25519 automatically.
- Ensure the signed message matches exactly (including newlines) what the server reconstructs for verification.

### "Invalid or expired nonce"

- Nonces expire after `NONCE_TTL_SEC` seconds. Ensure the client requests a fresh nonce immediately before constructing the signed message.
- Each nonce is single-use — do not cache nonces across sign-in attempts.

### VFT balance always returns 0

- Verify `VFT_PROGRAM_ID` matches the deployed contract on the target network.
- Ensure `VARA_WS` points to the correct network (testnet vs mainnet).
- The `getVFTBalance` function returns 0 on error instead of throwing, to produce a `403` rather than `500`. Check server logs for the underlying error.

---

## Security notes

- **Use HTTPS in production.** Running over plain HTTP exposes JWTs and signed messages to network interception.
- **`JWT_SECRET` must be at least 32 random characters.** Use `openssl rand -base64 32` to generate.
- **Rate-limit `/auth/nonce` and `/auth/verify`.** These endpoints make on-chain calls and are the most expensive. Add `express-rate-limit` to prevent abuse.
- **The nonce store is in-memory.** In a horizontally scaled deployment, use Redis for nonce storage to prevent nonces from being valid on only one instance.
- **Token gating is enforced at auth time**, not per-request. A user with enough tokens at login retains access until their JWT expires or is refreshed (with `RECHECK_ON_REFRESH=true`).

---

## Summary

This pattern provides a complete authentication layer for Vara dApps:

- **Identity**: proven via Polkadot signature (SIWE-style)
- **Authorization**: enforced via on-chain VFT balance threshold
- **Session**: managed via short-lived JWTs with optional re-check on refresh

Use it as a standalone microservice or embed it into a larger backend. The VFT client (`src/vft.ts`) is the same Sails-JS generated client used in the contracts — it serves as the bridge between the authentication server and the on-chain state.
