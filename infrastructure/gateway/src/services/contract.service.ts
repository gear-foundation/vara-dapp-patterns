import { Sails } from "sails-js";
import { HexString } from "@gear-js/api";
import { KeyringPair } from "@polkadot/keyring/types";
import { VftInitConfig } from "../utils/vara.utils";
import { ONE_VARA } from "../config/constants";

const ZERO_ADDRESS =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

/// ContractService
///
/// A stateless service layer with pure static methods.
/// Each method receives its dependencies (sails instance, signer) as parameters,
/// keeping the service easy to test and free of hidden state.
///
/// The Sails fluent API follows this call chain for commands (state mutations):
///
///   sails.services.<ServiceName>.functions.<FunctionName>(args)
///     .withAccount(signer)     — attach the server-side signing keypair
///     .withValue(BigInt(ONE_VARA)) — send VARA with the call (required for activation)
///     .calculateGas()          — estimate gas; returns a ready-to-send transaction
///
///   const { response } = await transaction.signAndSend();
///   const result = await response();  — wait for program-level reply
///
/// For queries (read-only, no gas, no state change):
///
///   const result = await sails.services.<ServiceName>.queries.<QueryName>(args).call();
export class ContractService {
  /// Deploy a new VFT program instance via the factory contract.
  ///
  /// The factory receives the init config, uploads the child program on-chain,
  /// and emits a `ProgramCreated` event with the new program's address.
  static async createProgram(
    sails: Sails,
    signer: KeyringPair,
    initConfig: VftInitConfig
  ): Promise<unknown> {
    const transaction = await sails.services.Service.functions
      .CreateProgram(initConfig)
      .withAccount(signer)
      .withValue(BigInt(ONE_VARA))
      .calculateGas();

    const { response } = await transaction.signAndSend();
    return response();
  }

  /// Create a liquidity pool for the token pair (tokenA, tokenB).
  ///
  /// After the factory creates the pool on-chain, this method queries the
  /// pool factory to obtain the canonical pair address and returns it.
  static async createPool(
    factorySails: Sails,
    poolFactorySails: Sails,
    signer: KeyringPair,
    tokenA: HexString,
    tokenB: HexString
  ): Promise<HexString> {
    const transaction = await factorySails.services.Service.functions
      .CreatePool(tokenA, tokenB)
      .withAccount(signer)
      .withValue(BigInt(ONE_VARA))
      .calculateGas();

    const { response } = await transaction.signAndSend();
    await response();

    // The factory emits an event but does not return the pair address directly.
    // We query the pool factory registry to resolve the canonical pair address.
    const pairAddress = await this.getPairAddress(
      poolFactorySails,
      tokenA,
      tokenB
    );

    if (!pairAddress || pairAddress === ZERO_ADDRESS) {
      throw new Error("Pool was created but pair address not found in registry");
    }

    return pairAddress;
  }

  /// Create a pool pairing a new token with a registered (existing) token.
  ///
  /// Because the pair address is not returned by the factory transaction,
  /// we resolve it by querying the full pairs registry after a brief wait
  /// for state propagation, then returning the most recently added pair.
  static async createPoolWithRegisteredToken(
    factorySails: Sails,
    poolFactorySails: Sails,
    signer: KeyringPair,
    token: HexString,
    registeredToken: HexString | null = null
  ): Promise<HexString> {
    const transaction = await factorySails.services.Service.functions
      .CreatePoolWithRegisteredToken(token, registeredToken)
      .withAccount(signer)
      .withValue(BigInt(ONE_VARA))
      .calculateGas();

    const { response } = await transaction.signAndSend();
    await response();

    // Brief delay to allow the runtime to propagate the new pair into state.
    // In a production system, replace with event subscription or polling.
    await new Promise((r) => setTimeout(r, 3_000));

    const allPairs = await this.getAllPairs(poolFactorySails);
    if (allPairs.length === 0) {
      throw new Error("No pairs found after pool creation");
    }

    const lastPair = allPairs[allPairs.length - 1];
    return lastPair[1] as HexString;
  }

  /// Composite operation: deploy a VFT program and immediately create a pool for it.
  ///
  /// This demonstrates on-chain operation composition: the output of the first
  /// call (program address) becomes the input of the second call (pool creation).
  static async createProgramAndPool(
    factorySails: Sails,
    poolFactorySails: Sails,
    signer: KeyringPair,
    initConfig: VftInitConfig,
    registeredToken: HexString | null = null
  ): Promise<{ programResponse: unknown; pairAddress: HexString }> {
    // Phase 1: Deploy the VFT program
    const programResponse = await this.createProgram(
      factorySails,
      signer,
      initConfig
    );

    // Extract the new program's address from the factory response
    const response = programResponse as { programCreated?: { address: HexString } };
    if (!response.programCreated?.address) {
      throw new Error("Program creation did not return expected address");
    }
    const tokenAddress = response.programCreated.address;
    console.log(`[ContractService] Program deployed at: ${tokenAddress}`);

    // Brief delay to ensure the newly deployed program is queryable
    await new Promise((r) => setTimeout(r, 2_000));

    // Phase 2: Create pool for the new token
    const pairAddress = await this.createPoolWithRegisteredToken(
      factorySails,
      poolFactorySails,
      signer,
      tokenAddress,
      registeredToken
    );

    return { programResponse, pairAddress };
  }

  // ─── Query methods ──────────────────────────────────────────────────────────

  /// Read-only: return all admin addresses from the factory contract.
  static async getAdmins(sails: Sails): Promise<string[]> {
    return sails.services.Service.queries.Admins().call() as Promise<string[]>;
  }

  /// Read-only: return the ID-to-address mapping from the factory.
  static async getIdToAddress(
    sails: Sails
  ): Promise<Array<[number, string]>> {
    return sails.services.Service.queries
      .IdToAddress()
      .call() as Promise<Array<[number, string]>>;
  }

  /// Read-only: return the total number of deployed programs from the factory.
  static async getNumber(sails: Sails): Promise<number> {
    return sails.services.Service.queries.Number().call() as Promise<number>;
  }

  /// Read-only: return the full program registry from the factory.
  static async getRegistry(sails: Sails): Promise<unknown> {
    return sails.services.Service.queries.Registry();
  }

  /// Read-only: return the pool factory address stored in the factory.
  static async getPoolFactoryAddress(sails: Sails): Promise<HexString> {
    return sails.services.Service.queries
      .PoolFactoryAddress()
      .call() as Promise<HexString>;
  }

  /// Read-only: return the pair address for a given token pair from the pool factory.
  /// Returns `null` if no pool exists for this pair.
  static async getPairAddress(
    poolFactorySails: Sails,
    tokenA: HexString,
    tokenB: HexString
  ): Promise<HexString | null> {
    const result = await poolFactorySails.services.Factory.queries
      .GetPair(tokenA, tokenB)
      .call();

    const addr = result as HexString;
    return addr === ZERO_ADDRESS ? null : addr;
  }

  /// Read-only: return all registered pairs from the pool factory.
  static async getAllPairs(
    poolFactorySails: Sails
  ): Promise<Array<[[HexString, HexString], HexString]>> {
    return poolFactorySails.services.Factory.queries
      .Pairs()
      .call() as Promise<Array<[[HexString, HexString], HexString]>>;
  }

  /// Read-only: return the protocol fee recipient address from the pool factory.
  static async getFeeTo(poolFactorySails: Sails): Promise<HexString> {
    return poolFactorySails.services.Factory.queries
      .FeeTo()
      .call() as Promise<HexString>;
  }

  /// Read-only: return the treasury ID from the pool factory.
  static async getTreasuryId(poolFactorySails: Sails): Promise<HexString> {
    return poolFactorySails.services.Factory.queries
      .TreasuryId()
      .call() as Promise<HexString>;
  }
}
