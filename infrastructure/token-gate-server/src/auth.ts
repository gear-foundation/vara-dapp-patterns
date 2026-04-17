import jwt from "jsonwebtoken";
import { signatureVerify } from "@polkadot/util-crypto";
import { z } from "zod";
import { randomUUID } from "node:crypto";

/// In-memory nonce store: nonce → expiration timestamp (ms).
/// Each nonce is single-use: it is deleted immediately on consumption.
export const nonceStore = new Map<string, number>();

/// Issue a cryptographically random nonce and store it with a TTL.
/// The nonce is returned to the client which must include it in the
/// signed message to prove liveness (prevents pre-signed message replay).
export function issueNonce(ttlSec: number): string {
  const nonce = randomUUID();
  nonceStore.set(nonce, Date.now() + ttlSec * 1_000);
  return nonce;
}

/// Consume a nonce: validate it exists and has not expired, then delete it.
/// Returns `false` if the nonce is unknown or expired — caller should reject the request.
///
/// The delete-on-read semantics ensure each nonce can only be used once,
/// preventing replay attacks even within the TTL window.
export function consumeNonce(nonce: string): boolean {
  const exp = nonceStore.get(nonce);
  if (!exp) return false;
  nonceStore.delete(nonce);
  return exp > Date.now();
}

/// Verify a Polkadot/Substrate sr25519 or ed25519 signature.
/// Uses `@polkadot/util-crypto` which handles both signature schemes transparently.
export function verifySignature(
  address: string,
  message: string,
  signature: string
): boolean {
  const { isValid } = signatureVerify(message, signature, address);
  return isValid;
}

/// Sign a JWT with the given subject (wallet address) and TTL.
/// `hasAccess: true` is embedded as a claim to simplify entitlement checks
/// downstream without re-querying the token balance.
export function signJwt(
  address: string,
  ttlMin: number,
  secret: string
): string {
  return jwt.sign({ sub: address, hasAccess: true }, secret, {
    expiresIn: `${ttlMin}m`,
  });
}

/// Zod schema for the `/auth/verify` request body.
/// Validates that all three fields are present and minimally well-formed
/// before any expensive crypto or on-chain operation is attempted.
export const SignedMessageSchema = z.object({
  address: z.string().min(3),
  message: z.string().min(5),
  signature: z.string().min(10),
});

/// Extract the value of a `Key: value` line from a multi-line signed message.
/// Returns an empty string if the key is not found.
///
/// The signed message format uses one key-value pair per line:
///   Nonce: <uuid>
///   Domain: <domain>
///   IssuedAt: <ISO 8601 timestamp>
///   ExpiresIn: <duration e.g. "600s">
export function extractLine(message: string, key: string): string {
  const line = message
    .split("\n")
    .find((l) => l.startsWith(`${key}:`));
  return line?.split(":").slice(1).join(":").trim() ?? "";
}
