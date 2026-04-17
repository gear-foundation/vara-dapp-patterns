import dotenv from "dotenv";
dotenv.config();

function mustEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

export const NETWORK                 = mustEnv("NETWORK");
export const FACTORY_CONTRACT_ID     = mustEnv("FACTORY_CONTRACT_ID") as `0x${string}`;
export const POOL_FACTORY_CONTRACT_ID = mustEnv("POOL_FACTORY_CONTRACT_ID") as `0x${string}`;
export const FACTORY_IDL             = mustEnv("FACTORY_IDL");
export const POOL_FACTORY_IDL        = mustEnv("POOL_FACTORY_IDL");
export const WALLET_NAME             = mustEnv("WALLET_NAME");
export const WALLET_MNEMONIC         = mustEnv("WALLET_MNEMONIC");
export const PORT                    = Number(process.env.PORT ?? 3000);
export const NODE_ENV                = process.env.NODE_ENV ?? "development";
export const API_KEY                 = process.env.API_KEY ?? "";

/// 1 VARA in planck units (10^12).
/// Used as the value sent with contract-creation and pool-creation transactions
/// to cover the program activation deposit required by the Gear runtime.
export const ONE_VARA = 1_000_000_000_000n;
