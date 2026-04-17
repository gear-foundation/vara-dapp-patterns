import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import jwt from "jsonwebtoken";
import { GearApi } from "@gear-js/api";
import {
  extractLine,
  issueNonce,
  consumeNonce,
  verifySignature,
  signJwt,
  SignedMessageSchema,
} from "./auth";
import { getVFTBalance } from "./gear";

// ─── Configuration ────────────────────────────────────────────────────────────

const PORT                 = Number(process.env.PORT ?? 3000);
const JWT_SECRET           = mustEnv("JWT_SECRET");
const VARA_WS              = mustEnv("VARA_WS");
const EXPECTED_DOMAIN      = process.env.EXPECTED_DOMAIN ?? "";
const EXPECTED_CHAIN_ID    = process.env.EXPECTED_CHAIN_ID ?? "";
const VFT_DECIMALS         = intEnv("VFT_DECIMALS", 0);
const VFT_THRESHOLD_HUMAN  = intEnv("VFT_THRESHOLD", 3_000);
const NONCE_TTL            = intEnv("NONCE_TTL_SEC", 600);
const JWT_TTL_MIN          = intEnv("JWT_TTL_MIN", 20);
const CLOCK_SKEW_MS        = intEnv("CLOCK_SKEW_MS", 2 * 60 * 1_000);
const REFRESH_MIN_REMAIN   = intEnv("REFRESH_MIN_REMAIN_SEC", 300);
const RECHECK_ON_REFRESH   =
  (process.env.RECHECK_ON_REFRESH ?? "true").toLowerCase() === "true";
const ALLOWED_ORIGINS      = (process.env.ALLOWED_ORIGINS ?? "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// ─── App setup ────────────────────────────────────────────────────────────────

const app = express();
app.use(helmet());
app.use(
  cors({
    origin: (origin, cb) => {
      if (
        !origin ||
        ALLOWED_ORIGINS.includes("*") ||
        ALLOWED_ORIGINS.includes(origin)
      ) {
        cb(null, true);
      } else {
        cb(new Error("CORS Error: origin not allowed"));
      }
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "1mb" }));

// ─── Vara API (lazy singleton) ────────────────────────────────────────────────

let gearApi: GearApi | null = null;

async function getApi(): Promise<GearApi> {
  if (gearApi) return gearApi;
  gearApi = await GearApi.create({ providerAddress: VARA_WS });

  gearApi.provider?.on?.("error", (e: unknown) =>
    console.error("[GearApi] provider error:", e)
  );
  gearApi.provider?.on?.("disconnected", () =>
    console.warn("[GearApi] disconnected")
  );
  gearApi.provider?.on?.("connected", () =>
    console.log("[GearApi] connected")
  );

  return gearApi;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Health
app.get("/health", (_req, res) =>
  res.json({ ok: true, time: new Date().toISOString(), rpc: VARA_WS })
);

// 1) Nonce
//
// The client must request a nonce before constructing the signed message.
// The nonce is single-use and expires after NONCE_TTL seconds.
app.post("/auth/nonce", (_req, res) => {
  const nonce = issueNonce(NONCE_TTL);
  return res.json({ nonce, expiresIn: NONCE_TTL });
});

// 2) Verify
//
// The client submits the wallet address, the signed message, and the signature.
// The server:
//   1. Parses and validates the request body (Zod)
//   2. Extracts fields from the signed message
//   3. Validates and consumes the nonce (one-time use)
//   4. Checks domain / chainId if configured
//   5. Verifies message freshness (clock skew tolerance)
//   6. Verifies the Polkadot signature
//   7. Queries the VFT balance on-chain
//   8. Applies the token gate threshold
//   9. Issues a JWT on success
app.post("/auth/verify", async (req, res) => {
  try {
    const { address, message, signature } = SignedMessageSchema.parse(req.body);

    // Extract key-value fields from the signed message body
    const nonce     = mustExtract(message, "Nonce");
    const domain    = mustExtract(message, "Domain");
    const chainId   = mustExtract(message, "ChainId");
    const issuedAt  = mustExtract(message, "IssuedAt");
    const expiresIn = mustExtract(message, "ExpiresIn");

    // Nonce validation: consumes and invalidates in one atomic operation
    if (!consumeNonce(nonce)) {
      return sendError(res, 400, "Invalid or expired nonce");
    }

    // Optional domain and chainId enforcement
    if (EXPECTED_DOMAIN && domain !== EXPECTED_DOMAIN) {
      return sendError(res, 400, "Invalid domain");
    }
    if (EXPECTED_CHAIN_ID && chainId !== EXPECTED_CHAIN_ID) {
      return sendError(res, 400, "Invalid chainId");
    }

    // Timestamp freshness check with clock skew tolerance
    if (!isMessageFresh(issuedAt, expiresIn, CLOCK_SKEW_MS)) {
      return sendError(res, 400, "Message expired or timestamp invalid");
    }

    // Polkadot signature verification
    if (!verifySignature(address, message, signature)) {
      return sendError(res, 401, "Invalid signature");
    }

    // On-chain VFT balance check
    const api = await getApi();
    const balRaw = await getVFTBalance(address, api);
    const thresholdRaw =
      BigInt(VFT_THRESHOLD_HUMAN) * 10n ** BigInt(VFT_DECIMALS);
    const balBigInt = toSafeBigInt(balRaw);

    if (balBigInt < thresholdRaw) {
      return res.status(403).json({
        error: "Insufficient token balance",
        balance: toHuman(balBigInt, VFT_DECIMALS),
        threshold: toHuman(thresholdRaw, VFT_DECIMALS),
        decimals: VFT_DECIMALS,
      });
    }

    // All checks passed — issue JWT
    const token = signJwt(address, JWT_TTL_MIN, JWT_SECRET);

    return res.json({
      jwt: token,
      balance: toHuman(balBigInt, VFT_DECIMALS),
      threshold: toHuman(thresholdRaw, VFT_DECIMALS),
      decimals: VFT_DECIMALS,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Bad request";
    console.error("[/auth/verify] error:", e);
    return sendError(res, 400, msg);
  }
});

// 3) Refresh
//
// Refreshes a JWT if it has less than REFRESH_MIN_REMAIN_SEC seconds remaining.
// If RECHECK_ON_REFRESH is true, re-validates the VFT balance before issuing
// the new token — ensuring that access is revoked if the user transfers tokens.
app.post("/auth/refresh", async (req, res) => {
  try {
    const token = getBearerToken(req);
    if (!token) return sendError(res, 401, "Missing token");

    const payload = jwt.verify(token, JWT_SECRET) as {
      sub: string;
      hasAccess?: boolean;
      exp?: number;
    };

    const remain = secondsUntil(payload.exp);

    // Token still has enough time remaining — return as-is
    if (remain > REFRESH_MIN_REMAIN) {
      return res.json({ jwt: token, remainingSec: remain, refreshed: false });
    }

    // Optionally re-check on-chain balance before renewing
    if (RECHECK_ON_REFRESH) {
      const api = await getApi();
      const balRaw = await getVFTBalance(payload.sub, api);
      const thresholdRaw =
        BigInt(VFT_THRESHOLD_HUMAN) * 10n ** BigInt(VFT_DECIMALS);
      const balBigInt = toSafeBigInt(balRaw);

      if (balBigInt < thresholdRaw) {
        return res.status(403).json({
          error: "Insufficient balance on refresh",
          balance: toHuman(balBigInt, VFT_DECIMALS),
          threshold: toHuman(thresholdRaw, VFT_DECIMALS),
        });
      }
    }

    const newJwt = signJwt(payload.sub, JWT_TTL_MIN, JWT_SECRET);
    const newExp = (jwt.decode(newJwt) as { exp?: number })?.exp;

    return res.json({
      jwt: newJwt,
      remainingSec: secondsUntil(newExp),
      refreshed: true,
    });
  } catch {
    return sendError(res, 401, "Invalid or expired token");
  }
});

// 4) Entitlement check
//
// Lightweight endpoint that verifies a JWT and returns the embedded claims.
// Useful for server-side middleware in downstream services.
app.get("/entitlement", (req, res) => {
  try {
    const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return sendError(res, 401, "Missing token");

    const payload = jwt.verify(token, JWT_SECRET) as {
      sub: string;
      hasAccess: boolean;
    };
    return res.json({ ok: true, address: payload.sub, hasAccess: payload.hasAccess });
  } catch {
    return sendError(res, 401, "Invalid or expired token");
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

const server = app.listen(PORT, () => {
  console.log(`🔐 token-gate-server running on port ${PORT}`);
  console.log(`   VFT threshold: ${VFT_THRESHOLD_HUMAN} (decimals: ${VFT_DECIMALS})`);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function shutdown() {
  console.log("Closing server...");
  server.close(() => {
    console.log("HTTP server closed.");
    process.exit(0);
  });
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function mustEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

function intEnv(key: string, def: number): number {
  const v = process.env[key];
  if (!v) return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function mustExtract(message: string, key: string): string {
  const v = extractLine(message, key);
  if (!v) throw new Error(`Missing field in signed message: ${key}`);
  return v;
}

function isMessageFresh(
  issuedAt: string,
  expiresIn: string,
  skewMs: number
): boolean {
  const issued = Date.parse(issuedAt);
  if (Number.isNaN(issued)) return false;
  const durMs = parseDurationMs(expiresIn);
  if (durMs <= 0) return false;
  const now = Date.now();
  return now >= issued - skewMs && now <= issued + durMs + skewMs;
}

function parseDurationMs(s: string): number {
  const m = String(s)
    .trim()
    .match(/^(\d+)\s*([smh])?$/i);
  if (!m) return 0;
  const val = Number(m[1]);
  switch ((m[2] ?? "s").toLowerCase()) {
    case "s": return val * 1_000;
    case "m": return val * 60 * 1_000;
    case "h": return val * 60 * 60 * 1_000;
    default:  return 0;
  }
}

function toSafeBigInt(n: number): bigint {
  if (!Number.isFinite(n)) return 0n;
  return BigInt(Math.trunc(n));
}

function toHuman(v: bigint, decimals: number): number {
  if (decimals <= 0) return Number(v);
  const denom = 10 ** Math.min(decimals, 15);
  const res = Number(v) / denom;
  if (decimals > 15) return res / 10 ** (decimals - 15);
  return res;
}

function sendError(res: express.Response, code: number, error: string) {
  return res.status(code).json({ error });
}

function getBearerToken(req: express.Request): string | null {
  const auth = req.headers.authorization ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

function secondsUntil(exp?: number): number {
  if (!exp) return 0;
  return exp - Math.floor(Date.now() / 1_000);
}
