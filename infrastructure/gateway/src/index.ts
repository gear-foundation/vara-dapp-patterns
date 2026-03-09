import express, { Express, Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import {
  NETWORK,
  FACTORY_CONTRACT_ID,
  POOL_FACTORY_CONTRACT_ID,
  FACTORY_IDL,
  POOL_FACTORY_IDL,
  WALLET_NAME,
  WALLET_MNEMONIC,
  PORT,
  NODE_ENV,
} from "./config/constants";
import {
  createGearApi,
  gearKeyringByWalletData,
  sailsInstance,
} from "./utils/vara.utils";
import contractRoutes from "./routes/contract.routes";

/// Server
///
/// Class-based Express server that manages the full lifecycle of the gateway:
///
///   constructor()          — configure middleware and routes
///   initializeVaraNetwork() — connect to Vara, load wallet, create Sails instances
///   start()               — init + listen
///   shutdown()            — disconnect + exit
///
/// Shared resources (api, sails instances, signer) are stored in `app.locals`
/// so that all route handlers can access them without importing globals or
/// using module-level singletons. This pattern makes the gateway easy to test
/// by swapping `app.locals` values in test setup.
class Server {
  private app: Express;

  constructor() {
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  private setupMiddleware(): void {
    this.app.use(helmet());

    this.app.use(
      cors({
        origin: process.env.ALLOWED_ORIGINS?.split(",") ?? "*",
        credentials: true,
      })
    );

    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // Request logger
    this.app.use((req: Request, _res: Response, next: NextFunction) => {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
      next();
    });
  }

  private setupRoutes(): void {
    // Root — API discovery
    this.app.get("/", (_req: Request, res: Response) => {
      res.json({
        success: true,
        message: "Vara Network API Gateway",
        version: "2.0.0",
        endpoints: {
          health:                        "GET  /api/health",
          createProgram:                 "POST /api/create-program",
          createPool:                    "POST /api/create-pool",
          createPoolWithRegisteredToken: "POST /api/create-pool-with-registered-token",
          createProgramAndPool:          "POST /api/create-program-and-pool",
          admins:                        "GET  /api/admins",
          idToAddress:                   "GET  /api/id-to-address",
          number:                        "GET  /api/number",
          registry:                      "GET  /api/registry",
          poolFactoryAddress:            "GET  /api/pool-factory-address",
          pairAddress:                   "GET  /api/pair-address?token_a=<addr>&token_b=<addr>",
        },
      });
    });

    this.app.use("/api", contractRoutes);

    // 404 handler
    this.app.use((req: Request, res: Response) => {
      res.status(404).json({
        success: false,
        error: "Not Found",
        message: `Route ${req.method} ${req.path} not found`,
      });
    });
  }

  private setupErrorHandling(): void {
    this.app.use(
      (err: Error, _req: Request, res: Response, _next: NextFunction) => {
        console.error("[Gateway] Unhandled error:", err);
        res.status(500).json({
          success: false,
          error: "Internal Server Error",
          message:
            NODE_ENV === "development"
              ? err.message
              : "An unexpected error occurred",
          ...(NODE_ENV === "development" && { stack: err.stack }),
        });
      }
    );
  }

  /// Connect to the Vara network and initialize shared resources.
  /// Resources are stored in `app.locals` for controller access.
  private async initializeVaraNetwork(): Promise<void> {
    console.log(`[Gateway] Connecting to Vara Network: ${NETWORK}`);
    const api = await createGearApi(NETWORK);
    console.log("[Gateway] ✓ Connected to Vara Network");

    console.log("[Gateway] Loading wallet...");
    const signer = await gearKeyringByWalletData(WALLET_NAME, WALLET_MNEMONIC);
    console.log(`[Gateway] ✓ Signer: ${signer.address}`);

    console.log(`[Gateway] Initializing Factory Sails: ${FACTORY_CONTRACT_ID}`);
    const factorySails = await sailsInstance(
      api,
      FACTORY_CONTRACT_ID,
      FACTORY_IDL
    );
    console.log("[Gateway] ✓ Factory Sails ready");

    console.log(`[Gateway] Initializing Pool Factory Sails: ${POOL_FACTORY_CONTRACT_ID}`);
    const poolFactorySails = await sailsInstance(
      api,
      POOL_FACTORY_CONTRACT_ID,
      POOL_FACTORY_IDL
    );
    console.log("[Gateway] ✓ Pool Factory Sails ready");

    // Store in app.locals — accessible in all route handlers via req.app.locals
    this.app.locals.api             = api;
    this.app.locals.factorySails    = factorySails;
    this.app.locals.poolFactorySails = poolFactorySails;
    this.app.locals.signer          = signer;
  }

  public async start(): Promise<void> {
    await this.initializeVaraNetwork();

    this.app.listen(PORT, () => {
      console.log("\n" + "=".repeat(60));
      console.log(`  Vara Gateway running on port ${PORT}`);
      console.log(`  Environment: ${NODE_ENV}`);
      console.log(`  Network: ${NETWORK}`);
      console.log("=".repeat(60) + "\n");
    });
  }

  public async shutdown(): Promise<void> {
    console.log("[Gateway] Shutting down...");
    if (this.app.locals.api) {
      await this.app.locals.api.provider.disconnect();
      console.log("[Gateway] ✓ Disconnected from Vara Network");
    }
    process.exit(0);
  }
}

const server = new Server();
server.start().catch((err) => {
  console.error("[Gateway] Fatal startup error:", err);
  process.exit(1);
});

process.on("SIGINT", () => server.shutdown());
process.on("SIGTERM", () => server.shutdown());

process.on("unhandledRejection", (reason) => {
  console.error("[Gateway] Unhandled rejection:", reason);
});

export default server;
