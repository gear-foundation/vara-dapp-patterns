# Gasless Voucher Server (Gear / Vara)

A minimal but production-oriented **gasless infrastructure server** that manages the full lifecycle of Vara vouchers on behalf of user accounts.

In the Gear/Vara ecosystem, a **voucher** is an on-chain escrow that allows a designated `spender` address to pay transaction fees for calls targeting a specific program — without holding any VARA themselves. This server acts as the off-chain counterpart: it holds the private key of an issuer account, exposes a REST API, and submits the on-chain extrinsics when a dApp client requests a voucher.

## Full code reference

- Voucher service: [`src/lib.ts`](./src/lib.ts)
- HTTP server + endpoints: [`src/index.ts`](./src/index.ts)
- Environment template: [`.env.txt`](./.env.txt)

---

## Core concepts

### Roles

- **Voucher Issuer Account**
  A server-side account (loaded from `VOUCHER_ACCOUNT_SEED_HEX`) that submits and pays for all voucher extrinsics. It must hold enough VARA to cover the total cost of all vouchers it issues.

- **Spender (user account)**
  The end-user's wallet address. The voucher grants this address permission to call the program without holding VARA themselves.

- **Program**
  The smart contract (identified by `PROGRAM_ID`) that all vouchers issued by this server are scoped to. A voucher is only valid for calls targeting this specific program.

### What is a Vara voucher?

A voucher is created via the `api.voucher.issue()` extrinsic. Once on-chain, the Gear runtime automatically uses the voucher's balance to pay for gas when the spender calls the associated program. The spender's personal balance is never touched.

This enables **gasless UX**: users can interact with a dApp without owning any network tokens.

### Voucher lifecycle

```
dApp frontend                  Gasless Server                  Vara Network
     │                               │                               │
     │── POST /gasless/voucher/request ──────────────────────────────►│
     │   { account, amount?, durationInSec? }                        │
     │                               │                               │
     │                               │── api.voucher.issue() ───────►│
     │                               │   extrinsic.signAndSend()     │
     │                               │                               │
     │                               │◄── VoucherIssued event ───────│
     │                               │    { voucherId }              │
     │                               │                               │
     │◄── { voucherId } ─────────────│                               │
     │                               │                               │
     │                               │                               │
     │  [user sends tx using voucher]│                               │
     │────────────────────────────────────────────────────────────── ►│
     │  (gas deducted from voucher, not from user's balance)         │
     │                               │                               │
     │── POST /prolong ──────────────►│                               │
     │   { voucherId, balance, durationInSec }                       │
     │                               │── api.voucher.update() ──────►│
     │                               │◄── VoucherUpdated event ──────│
     │                               │                               │
     │── POST /revoke ───────────────►│                               │
     │                               │── api.voucher.revoke() ──────►│
     │                               │◄── VoucherRevoked event ──────│
```

---

## Key fragment explained: `issue()`

The core of this service is the `issue()` method in `GaslessService`:

```typescript
const { extrinsic } = await this.api.voucher.issue(
  accountId,        // spender (AccountId32 hex)
  amount,           // initial balance in planck
  durationInBlocks, // how long the voucher is valid
  [programId],      // programs the voucher can be used for
  false             // transferable: false — non-transferable
);

const voucherId = await new Promise<HexString>((resolve, reject) => {
  extrinsic.signAndSend(
    this.voucherAccount,
    { nonce },
    ({ events, status }) => {
      if (!status.isInBlock) return;

      const viEvent = events.find(
        ({ event }) => event.method === "VoucherIssued"
      );

      if (viEvent) {
        const id = viEvent.event.data.voucherId.toHex();
        resolve(id);
      } else {
        reject(new Error("VoucherIssued event not found in block"));
      }
    }
  );
});
```

### Why `isInBlock` instead of `isFinalized`?

`isInBlock` resolves faster (typically 3–6 seconds vs 12–24 seconds for finalization). For voucher issuance in a UX context, block inclusion is sufficient: if the block is later reverted, the voucher would also be reverted, but such reverts are extremely rare on Vara. Use `isFinalized` only when you need the strongest guarantee.

### Why two-phase resolution?

The `signAndSend` callback can fire multiple times (once per status change: `Ready`, `Broadcast`, `InBlock`, `Finalized`). We guard with `if (!status.isInBlock) return` so we process events exactly once — when the extrinsic is included in a block. This prevents duplicate resolution of the Promise.

### Why explicit `nonce`?

```typescript
const nonce = await this.api.rpc.system.accountNextIndex(
  this.voucherAccount.address
);
extrinsic.signAndSend(this.voucherAccount, { nonce }, callback);
```

Without an explicit nonce, the Polkadot API queries the current on-chain nonce before signing. Under concurrent requests, two calls could read the same nonce and produce a collision. Fetching the nonce explicitly and passing it ensures correct sequencing when multiple vouchers are issued in rapid succession.

---

## REST API reference

| Method | Path | Body | Response |
|--------|------|------|----------|
| `GET` | `/health` | — | `{ ok: true, time: string }` |
| `POST` | `/gasless/voucher/request` | `{ account, amount?, durationInSec? }` | `{ voucherId }` |
| `GET` | `/gasless/voucher/:voucherId/status` | — | `{ enabled, exists, rawBalance? }` |
| `POST` | `/issue` | `{ account, amount, durationInSec }` | `{ voucherId }` (legacy alias) |
| `POST` | `/prolong` | `{ voucherId, account, balance, durationInSec }` | `200 OK` |
| `POST` | `/revoke` | `{ voucherId, account }` | `200 OK` |

### Default values for `/gasless/voucher/request`

| Parameter | Default | Description |
|-----------|---------|-------------|
| `amount` | `20_000_000_000_000` | Initial voucher balance in planck (= 20 VARA) |
| `durationInSec` | `3600` | Validity duration (1 hour = ~1200 blocks) |

---

## `issueIfNeeded` — idempotent issuance

```typescript
const voucherId = await gaslessService.issueIfNeeded(
  account,
  programId,
  amount,
  durationInSec
);
```

This variant first queries all existing vouchers for `account` and checks whether any of them are already scoped to `programId`. If found, it returns the existing voucher ID without submitting a new extrinsic.

**When to use:** call this from a frontend that runs on every page load. Avoids duplicate vouchers and unnecessary issuer balance consumption.

---

## `prolong` — extending a voucher

```typescript
const params: IUpdateVoucherParams = {};
if (prolongDurationInSec > 0) params.prolongDuration = durationInBlocks;
if (topUp > 0n)               params.balanceTopUp = topUp * BigInt(1e12);

const tx = this.api.voucher.update(account, voucherId, params);
```

`prolong` computes the top-up amount as `desiredBalance - currentBalance` so that the caller always specifies the final desired balance, not the delta. This avoids race conditions when multiple calls overlap.

---

## Environment variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `NODE_URL` | ✅ | Vara network WebSocket URL | `wss://testnet.vara.network` |
| `VOUCHER_ACCOUNT_SEED_HEX` | ✅ | Hex-encoded seed of the issuer account | `0xabc123...` |
| `PROGRAM_ID` | ✅ | HexString of the program vouchers target | `0xdef456...` |
| `PORT` | ❌ | HTTP port (default: `3000`) | `3001` |

### Generating a voucher issuer account

```bash
# Using subkey (from Substrate toolchain)
subkey generate --scheme sr25519 --output-type json

# Copy the "secretSeed" field and paste it as VOUCHER_ACCOUNT_SEED_HEX
```

Fund the account via the Vara faucet (testnet) or a transfer (mainnet) before starting the server.

---

## Build and run

```bash
# Install dependencies
yarn install

# Development (hot reload)
cp .env.txt .env
# Edit .env with your values
yarn dev

# Production
yarn build
yarn start
```

---

## Troubleshooting

### Enable Gear debug logs

If a voucher issuance fails silently, enable verbose `@gear-js/api` output:

```typescript
// In src/lib.ts, replace the silent error path:
reject(
  efEvent
    ? this.api.getExtrinsicFailedError(efEvent.event)
    : new Error("VoucherIssued event not found")
);

// With explicit logging:
const rawError = efEvent
  ? this.api.getExtrinsicFailedError(efEvent.event)
  : new Error("VoucherIssued event not found");
console.error("[GaslessService] Detailed error:", rawError);
reject(rawError);
```

### "Insufficient balance" on issue

The issuer account balance must cover `amount` + existential deposit + transaction fee. A common cause of failure is funding the account with exactly the voucher amount but forgetting the fee overhead. Add at least 1 extra VARA as buffer.

### Nonce collision under load

If the server receives many concurrent voucher requests, nonce collisions may occur. For production workloads, serialize voucher issuance through a queue (e.g., a simple in-memory async queue or Redis) to guarantee sequential nonce usage.

---

## Security notes

- **Never commit** `VOUCHER_ACCOUNT_SEED_HEX` to version control. Use environment variables injected at runtime (Docker secrets, Render/Vercel env vars, AWS Secrets Manager).
- Add **rate limiting** (e.g., `express-rate-limit`) on `/gasless/voucher/request` to prevent abuse. A single issuer account can be drained quickly if the endpoint is open.
- In production, run behind **HTTPS** (TLS termination via a reverse proxy or PaaS).
- Consider **per-account issuance limits**: track how many vouchers each `account` address has requested and impose a daily cap.
- The `transferable: false` flag on `api.voucher.issue()` prevents the spender from transferring the voucher to another account, limiting the blast radius if a voucher is misused.

---

## Notes

Use this pattern when:

- You want users to interact with your Vara program without owning VARA.
- You have a centralized backend that can hold the issuer account key.
- Voucher duration and amount are fixed or predictable (subscription model, limited actions).

For a fully decentralized gasless flow, consider the signless session approach in `contracts/signless-gasless`, which uses vouchers internally but does not require a centralized server to hold private keys.
