import { GearApi, GearKeyring, HexString } from "@gear-js/api";
import { KeyringPair } from "@polkadot/keyring/types";
import { Sails } from "sails-js";
import { SailsIdlParser } from "sails-js-parser";

/// Create and connect a GearApi instance to the given WebSocket endpoint.
/// The returned API is already ready — `api.isReadyOrError` has resolved.
export const createGearApi = async (network: string): Promise<GearApi> => {
  const api = await GearApi.create({ providerAddress: network });
  return api;
};

/// Create a server-side signer (KeyringPair) from a mnemonic phrase.
/// The `walletName` is used as the keypair name for logging purposes only.
export const gearKeyringByWalletData = async (
  walletName: string,
  walletMnemonic: string
): Promise<KeyringPair> => {
  const signer = await GearKeyring.fromMnemonic(walletMnemonic, walletName);
  return signer;
};

/// Create a Sails instance connected to a specific on-chain program.
///
/// Steps:
/// 1. Initialize the IDL parser (WASM-based, must await)
/// 2. Create a Sails instance wrapping the parser
/// 3. Attach the GearApi connection
/// 4. Set the target program ID
/// 5. Parse the IDL to expose typed services/functions/queries
///
/// After this call, the returned `Sails` instance exposes:
///   sails.services.<ServiceName>.functions.<FunctionName>(args)
///   sails.services.<ServiceName>.queries.<QueryName>(args).call()
export const sailsInstance = async (
  api: GearApi,
  contractId: HexString,
  idl: string
): Promise<Sails> => {
  const parser = await SailsIdlParser.new();
  const sails = new Sails(parser);

  sails.setApi(api);
  sails.setProgramId(contractId);
  sails.parseIdl(idl);

  return sails;
};

// ─── Domain types ─────────────────────────────────────────────────────────────

export interface VftInitConfig {
  name: string;
  symbol: string;
  decimals: number;
  admins: string[];
  mint_amount: bigint;
  mint_to: string;
}

export interface CreatePoolInput {
  token_a: string;
  token_b: string;
}

export interface CreatePoolWithRegisteredTokenInput {
  token: string;
  registered_token?: string | null;
}

export interface CreateProgramAndPoolInput {
  name: string;
  symbol: string;
  decimals: number;
  admins: string[];
  mint_amount: string;
  mint_to: string;
  registered_token?: string | null;
}
