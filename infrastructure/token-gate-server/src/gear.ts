import type { GearApi, HexString } from "@gear-js/api";
import { decodeAddress } from "@polkadot/util-crypto";
import { u8aToHex } from "@polkadot/util";
import { Program, Service } from "./vft";

/// Program ID of the VFT (Vara Fungible Token) contract used for balance gating.
/// Read from environment at module load time.
export const VFT_PROGRAM_ID = process.env.VFT_PROGRAM_ID!;

/// Convert any Substrate address (SS58 or hex) to a hex-encoded AccountId32.
/// The Sails VFT client expects hex addresses (`[u8;32]` encoded as hex string).
export const toHexAddress = (addr: string): HexString => {
  try {
    if (addr?.startsWith("0x") && addr.length > 2) return addr as HexString;
    const decoded = decodeAddress(addr);
    return u8aToHex(decoded) as HexString;
  } catch {
    console.warn("[gear] Failed to convert address:", addr);
    return addr as HexString;
  }
};

/// Query the VFT balance of `accountAddress` from the Vara network.
///
/// Uses the Sails-JS generated client (`Program` + `Service`) to call
/// `balanceOf` via `api.message.calculateReply()` — a read-only simulation
/// that does not submit any on-chain transaction.
///
/// Returns 0 on any error to allow the caller to apply the threshold check
/// and return a 403 rather than a 500, which is more informative for the client.
export const getVFTBalance = async (
  accountAddress: string,
  api: GearApi
): Promise<number> => {
  if (!accountAddress || !api) {
    console.warn("[gear] Missing accountAddress or api");
    return 0;
  }

  try {
    const program = new Program(api, VFT_PROGRAM_ID as HexString);
    const svc = new Service(program);
    const normalized = toHexAddress(accountAddress);

    const result = await svc.balanceOf(normalized);
    const balance = Number(result);

    if (isNaN(balance)) {
      console.warn("[gear] balanceOf returned NaN:", result);
      return 0;
    }

    return balance;
  } catch (error) {
    console.error("[gear] getVFTBalance error:", error);
    return 0;
  }
};
