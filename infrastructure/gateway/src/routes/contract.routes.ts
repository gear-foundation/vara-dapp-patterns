import { Router } from "express";
import { ContractController } from "../controllers/contract.controller";

const router = Router();

// Health
router.get("/health", ContractController.getHealth);

// Write endpoints (state mutations — require signer + gas)
router.post("/create-program",                      ContractController.createProgram);
router.post("/create-pool",                         ContractController.createPool);
router.post("/create-pool-with-registered-token",   ContractController.createPoolWithRegisteredToken);
router.post("/create-program-and-pool",             ContractController.createProgramAndPool);

// Query endpoints (read-only — no gas, no signer)
router.get("/admins",               ContractController.getAdmins);
router.get("/id-to-address",        ContractController.getIdToAddress);
router.get("/number",               ContractController.getNumber);
router.get("/registry",             ContractController.getRegistry);
router.get("/pool-factory-address", ContractController.getPoolFactoryAddress);
router.get("/pair-address",         ContractController.getPairAddress);

export default router;
