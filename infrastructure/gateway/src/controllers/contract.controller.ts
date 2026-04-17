import { Request, Response } from "express";
import { ContractService } from "../services/contract.service";
import {
  CreatePoolInput,
  CreatePoolWithRegisteredTokenInput,
  CreateProgramAndPoolInput,
  VftInitConfig,
} from "../utils/vara.utils";
import { HexString } from "@gear-js/api";

/// ContractController
///
/// Thin HTTP layer: reads shared resources from `req.app.locals`,
/// delegates all on-chain logic to ContractService, and serializes results.
///
/// `app.locals` is used as a lightweight dependency injection container:
/// the Server class populates it once at startup with the connected API,
/// Sails instances, and signer. Controllers receive these dependencies
/// without importing or instantiating them directly.
export class ContractController {
  // ─── Write endpoints ────────────────────────────────────────────────────────

  static async createProgram(req: Request, res: Response): Promise<void> {
    try {
      const { factorySails, signer } = req.app.locals;
      const initConfig: VftInitConfig = {
        name:         req.body.name,
        symbol:       req.body.symbol,
        decimals:     Number(req.body.decimals),
        admins:       req.body.admins ?? [],
        mint_amount:  BigInt(req.body.mint_amount ?? 0),
        mint_to:      req.body.mint_to ?? "",
      };

      const result = await ContractService.createProgram(
        factorySails,
        signer,
        initConfig
      );

      res.json({ success: true, data: result });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  static async createPool(req: Request, res: Response): Promise<void> {
    try {
      const { factorySails, poolFactorySails, signer } = req.app.locals;
      const { token_a, token_b }: CreatePoolInput = req.body;

      const pairAddress = await ContractService.createPool(
        factorySails,
        poolFactorySails,
        signer,
        token_a as HexString,
        token_b as HexString
      );

      res.json({ success: true, data: { pairAddress } });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  static async createPoolWithRegisteredToken(
    req: Request,
    res: Response
  ): Promise<void> {
    try {
      const { factorySails, poolFactorySails, signer } = req.app.locals;
      const { token, registered_token }: CreatePoolWithRegisteredTokenInput =
        req.body;

      const pairAddress = await ContractService.createPoolWithRegisteredToken(
        factorySails,
        poolFactorySails,
        signer,
        token as HexString,
        (registered_token as HexString) ?? null
      );

      res.json({ success: true, data: { pairAddress } });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  static async createProgramAndPool(
    req: Request,
    res: Response
  ): Promise<void> {
    try {
      const { factorySails, poolFactorySails, signer } = req.app.locals;
      const body: CreateProgramAndPoolInput = req.body;

      const result = await ContractService.createProgramAndPool(
        factorySails,
        poolFactorySails,
        signer,
        {
          name:        body.name,
          symbol:      body.symbol,
          decimals:    Number(body.decimals),
          admins:      body.admins ?? [],
          mint_amount: BigInt(body.mint_amount ?? 0),
          mint_to:     body.mint_to ?? "",
        },
        (body.registered_token as HexString) ?? null
      );

      res.json({ success: true, data: result });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // ─── Query endpoints ────────────────────────────────────────────────────────

  static async getHealth(req: Request, res: Response): Promise<void> {
    const { api } = req.app.locals;
    const chain = await api?.rpc?.system?.chain?.();
    res.json({ success: true, chain: chain?.toString() ?? "unknown" });
  }

  static async getAdmins(req: Request, res: Response): Promise<void> {
    try {
      const { factorySails } = req.app.locals;
      const admins = await ContractService.getAdmins(factorySails);
      res.json({ success: true, data: admins });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  }

  static async getIdToAddress(req: Request, res: Response): Promise<void> {
    try {
      const { factorySails } = req.app.locals;
      const data = await ContractService.getIdToAddress(factorySails);
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  }

  static async getNumber(req: Request, res: Response): Promise<void> {
    try {
      const { factorySails } = req.app.locals;
      const number = await ContractService.getNumber(factorySails);
      res.json({ success: true, data: number });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  }

  static async getRegistry(req: Request, res: Response): Promise<void> {
    try {
      const { factorySails } = req.app.locals;
      const registry = await ContractService.getRegistry(factorySails);
      res.json({ success: true, data: registry });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  }

  static async getPoolFactoryAddress(
    req: Request,
    res: Response
  ): Promise<void> {
    try {
      const { factorySails } = req.app.locals;
      const address = await ContractService.getPoolFactoryAddress(factorySails);
      res.json({ success: true, data: address });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  }

  static async getPairAddress(req: Request, res: Response): Promise<void> {
    try {
      const { poolFactorySails } = req.app.locals;
      const { token_a, token_b } = req.query as {
        token_a?: string;
        token_b?: string;
      };

      if (!token_a || !token_b) {
        res
          .status(400)
          .json({ success: false, error: "token_a and token_b are required" });
        return;
      }

      const pairAddress = await ContractService.getPairAddress(
        poolFactorySails,
        token_a as HexString,
        token_b as HexString
      );

      res.json({ success: true, data: { pairAddress } });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  }
}
